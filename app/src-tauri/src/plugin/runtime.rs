//! WASM のプラグインを動かす。ファイルには直に触れさせず、ホストの関数を通して読ませる。

use std::collections::HashMap;
use std::fs::File as FsFile;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store, UpdateDeadline};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use super::{By, Choice, Part, Reads, Registry, SettingDecl, SettingKind, UiRef, commands, os};
use crate::{library, thumb};

wasmtime::component::bindgen!({ world: "plugin", path: "../plugins/sdk/wit" });

use patchouli::plugin::host::{CommandArg, CommandOutput};
use patchouli::plugin::types;

/// 一度に読ませる量の上限。
pub const READ_MAX: u32 = 16 << 20;

/// WASM が続けて動いてよい長さ。外部ツールを動かしている時間は数えない。
const SETTINGS_LIMIT: Duration = Duration::from_secs(2);
const THUMBNAIL_LIMIT: Duration = Duration::from_secs(10);
const VIEW_LIMIT: Duration = Duration::from_secs(30);

/// 長さを確かめる間隔。
const TICK: Duration = Duration::from_millis(100);

fn engine() -> &'static Engine {
    static E: OnceLock<Engine> = OnceLock::new();
    E.get_or_init(|| {
        let mut config = Config::new();
        config.epoch_interruption(true);
        let engine = Engine::new(&config).expect("WASM の実行環境を作れない");
        let ticker = engine.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(TICK);
                ticker.increment_epoch();
            }
        });
        engine
    })
}

/// WASM が limit のうちに終わらなかった。
#[derive(Debug)]
struct TimedOut(Duration);

impl std::fmt::Display for TimedOut {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} 秒以内に終わりませんでした", self.0.as_secs())
    }
}

impl std::error::Error for TimedOut {}

/// limit を過ぎたら止める store を作る。
fn store(state: HostState) -> Store<HostState> {
    let mut store = Store::new(engine(), state);
    store.epoch_deadline_callback(|s| {
        let st = s.data();
        if st.started.elapsed().saturating_sub(st.outside) > st.limit {
            return Err(wasmtime::Error::new(TimedOut(st.limit)));
        }
        Ok(UpdateDeadline::Continue(1))
    });
    store
}

/// ここから limit の長さだけ動かせるようにする。
fn start(store: &mut Store<HostState>, limit: Duration) {
    let st = store.data_mut();
    st.limit = limit;
    st.started = Instant::now();
    st.outside = Duration::ZERO;
    store.set_epoch_deadline(1);
}

/// プラグイン id の呼び出しが失敗したときの文。
fn failed(id: &str, e: &wasmtime::Error) -> String {
    match e.downcast_ref::<TimedOut>() {
        Some(t) => format!(
            "プラグイン「{id}」の処理が {} 秒以内に終わらなかったため、停止しました",
            t.0.as_secs()
        ),
        None => format!("{id}: {e}"),
    }
}

pub struct HostState {
    wasi: WasiCtx,
    table: ResourceTable,
    /// いまの呼び出しで渡したファイル。File の handle はこの位置。
    files: Vec<PathBuf>,
    /// いま動いているプラグインの id（ログ用）と、登録の中での位置。
    current: String,
    index: usize,
    /// 設定の値を読むところ。設定の項目を聞いている間はない。
    reg: Option<Arc<Registry>>,
    /// Runner::reading のあいだに読んだ設定。
    reads: Option<Reads>,
    /// いまの呼び出しを始めた時刻と、動かしてよい長さ、そのうち外部ツールを動かしていた長さ。
    started: Instant,
    limit: Duration,
    outside: Duration,
}

impl HostState {
    fn new(reg: Option<Arc<Registry>>) -> HostState {
        // 環境変数・ファイル・ネットワークは何も渡さない
        HostState {
            wasi: WasiCtx::builder().build(),
            table: ResourceTable::new(),
            files: Vec::new(),
            current: String::new(),
            index: 0,
            reg,
            reads: None,
            started: Instant::now(),
            limit: Duration::ZERO,
            outside: Duration::ZERO,
        }
    }

    /// いま動いているプラグインが plugin.json に書いたコマンドの場所。
    fn command(&self, name: &str) -> Result<PathBuf, String> {
        let reg = self
            .reg
            .as_ref()
            .ok_or("現在は外部ツールを実行できません")?;
        let dep = reg.plugins[self.index]
            .manifest
            .declares(name)
            .ok_or_else(|| {
                format!(
                    "外部ツール「{name}」が plugin.json の required / optional に記載されていません"
                )
            })?;
        commands::check(name, dep).map_err(|u| match u {
            commands::Unmet::Missing => format!("{name} が見つかりません"),
            commands::Unmet::Old(v) => format!("{name} のバージョン（{v}）が古すぎます"),
            commands::Unmet::Unknown(e) => format!("{name} のバージョンを確認できません：{e}"),
        })
    }

    fn path(&self, f: &File) -> Result<&Path, String> {
        self.files
            .get(f.handle as usize)
            .map(PathBuf::as_path)
            .ok_or_else(|| "プラグインに渡されていないファイルです".into())
    }
}

impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl types::Host for HostState {}

impl patchouli::plugin::host::Host for HostState {
    fn command_available(&mut self, name: String) -> bool {
        self.command(&name).is_ok()
    }

    fn run_command(
        &mut self,
        name: String,
        args: Vec<CommandArg>,
        timeout_ms: Option<u32>,
    ) -> Result<CommandOutput, String> {
        let path = self.command(&name)?;
        let args = args
            .into_iter()
            .map(|a| match a {
                CommandArg::Text(s) => Ok(s.into()),
                CommandArg::File(f) => Ok(self.path(&f)?.as_os_str().to_owned()),
            })
            .collect::<Result<Vec<_>, String>>()?;
        let timeout = timeout_ms.map_or(commands::TIMEOUT, |ms| {
            std::time::Duration::from_millis(u64::from(ms))
        });
        let begun = Instant::now();
        let out = commands::run(&path, &args, timeout);
        self.outside += begun.elapsed();
        let out = out?;
        Ok(CommandOutput {
            code: out.code,
            stdout: out.stdout,
            stderr: out.stderr,
        })
    }

    fn read(&mut self, f: File, offset: u64, len: u32) -> Result<Vec<u8>, String> {
        read(self.path(&f)?, offset, len)
    }

    fn image_size(&mut self, f: File) -> Option<types::Dimensions> {
        let (width, height) = library::image_size(self.path(&f).ok()?)?;
        Some(types::Dimensions { width, height })
    }

    fn image_thumbnail(&mut self, f: File, edge: u32) -> Result<Vec<u8>, String> {
        thumb::shrink(self.path(&f)?, edge)
    }

    fn os_thumbnail(&mut self, f: File, edge: u32) -> Result<Vec<u8>, String> {
        os::thumbnail(self.path(&f)?, edge)
    }

    fn setting(&mut self, key: String) -> Option<types::SettingValue> {
        let v = self.reg.as_ref()?.setting(self.index, &key)?;
        let w = to_wit(&v);
        if let Some(r) = &mut self.reads {
            r.insert(key, v);
        }
        w
    }

    fn get_data(&mut self, key: String) -> Option<String> {
        self.reg.as_ref()?.data(self.index, &key)
    }

    fn set_data(&mut self, key: String, value: Option<String>) -> Result<(), String> {
        self.reg
            .as_ref()
            .ok_or("現在は値を保存できません")?
            .set_data(self.index, &key, value)
    }

    fn log(&mut self, message: String) {
        log::info!("[{}] {message}", self.current);
    }
}

/// path の中身を offset から最大 len バイト読む。
pub fn read(path: &Path, offset: u64, len: u32) -> Result<Vec<u8>, String> {
    let mut file = FsFile::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.take(u64::from(len.min(READ_MAX)))
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn to_wit(v: &Value) -> Option<types::SettingValue> {
    Some(match v {
        Value::Bool(b) => types::SettingValue::Toggle(*b),
        Value::Number(n) => types::SettingValue::Number(n.as_f64()?),
        Value::String(s) => types::SettingValue::Text(s.clone()),
        _ => return None,
    })
}

fn from_wit(v: types::SettingValue) -> Value {
    match v {
        types::SettingValue::Toggle(b) => Value::Bool(b),
        types::SettingValue::Number(n) => {
            serde_json::Number::from_f64(n).map_or(Value::Null, Value::Number)
        }
        types::SettingValue::Text(s) => Value::String(s),
    }
}

fn decl(s: types::Setting) -> SettingDecl {
    let kind = match s.kind {
        types::SettingKind::Toggle => SettingKind::Toggle,
        types::SettingKind::Number(r) => SettingKind::Number {
            min: r.min,
            max: r.max,
            step: r.step,
        },
        types::SettingKind::Text => SettingKind::Text,
        types::SettingKind::Choice(cs) => SettingKind::Choice {
            choices: cs
                .into_iter()
                .map(|c| Choice {
                    value: c.value,
                    label: c.label,
                })
                .collect(),
        },
    };
    SettingDecl {
        key: s.key,
        label: s.label,
        help: s.help,
        kind,
        default: from_wit(s.default),
    }
}

/// 読み込んで、すぐ動かせるようにしたプラグイン。
pub struct Prepared(PluginPre<HostState>);

impl Prepared {
    pub fn new(wasm: &[u8]) -> Result<Prepared, String> {
        let engine = engine();
        let component = Component::new(engine, wasm).map_err(|e| e.to_string())?;
        let mut linker = Linker::new(engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker).map_err(|e| e.to_string())?;
        Plugin::add_to_linker::<_, wasmtime::component::HasSelf<_>>(&mut linker, |s| s)
            .map_err(|e| e.to_string())?;
        let pre = linker
            .instantiate_pre(&component)
            .map_err(|e| e.to_string())?;
        Ok(Prepared(PluginPre::new(pre).map_err(|e| e.to_string())?))
    }

    /// 設定の項目を聞く。
    pub fn settings(&self, id: &str) -> Result<Vec<SettingDecl>, String> {
        let mut store = store(HostState::new(None));
        store.data_mut().current = id.to_owned();
        start(&mut store, SETTINGS_LIMIT);
        let p = self.0.instantiate(&mut store).map_err(|e| failed(id, &e))?;
        let list = p.call_settings(&mut store).map_err(|e| failed(id, &e))?;
        Ok(list.into_iter().map(decl).collect())
    }
}

/// できたサムネイルの PNG と、素材そのものの大きさ、作るときに読んだ設定。
pub type Made = (Vec<u8>, Option<(u32, u32)>, Reads);

/// 素材の詳細に出すもの。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ViewOut {
    Image,
    Video,
    Audio,
    /// WASM が PNG にしたもの（Runner::decode）を画像として出す。
    Decoded,
    /// 組み込み UI が描く。
    Ui(UiRef),
}

/// プラグインを呼ぶ窓口。スレッドごとに 1 つ作る。動かしたプラグインは使い回す。
pub struct Runner {
    reg: Arc<Registry>,
    store: Store<HostState>,
    instances: HashMap<usize, Plugin>,
}

impl Runner {
    pub fn new(reg: Arc<Registry>) -> Runner {
        Runner {
            store: store(HostState::new(Some(Arc::clone(&reg)))),
            reg,
            instances: HashMap::new(),
        }
    }

    pub fn registry(&self) -> &Arc<Registry> {
        &self.reg
    }

    /// part を by で受け持つプラグインで f を呼ぶ。受け持つものがなければ None。
    fn call<R>(
        &mut self,
        ext: &str,
        part: Part,
        by: By,
        path: &Path,
        limit: Duration,
        f: impl FnOnce(&Plugin, &mut Store<HostState>, &str, File) -> wasmtime::Result<R>,
    ) -> Option<Result<R, String>> {
        let (i, format) = self.reg.part(ext, part, by)?;
        let format = format.to_owned();
        Some(self.run(i, &format, ext, path, limit, f))
    }

    /// i 番目のプラグインで f を呼ぶ。起動から数えて limit のうちに終わらなければ止める。
    fn run<R>(
        &mut self,
        i: usize,
        format: &str,
        ext: &str,
        path: &Path,
        limit: Duration,
        f: impl FnOnce(&Plugin, &mut Store<HostState>, &str, File) -> wasmtime::Result<R>,
    ) -> Result<R, String> {
        let id = self.reg.plugins[i].manifest.id.clone();
        let size = std::fs::metadata(path).map_or(0, |m| m.len());
        start(&mut self.store, limit);
        if !self.instances.contains_key(&i) {
            let Some(pre) = self.reg.plugins[i].wasm.as_ref() else {
                return Err(format!("プラグイン「{id}」の plugin.wasm が見つかりません"));
            };
            match pre.0.instantiate(&mut self.store) {
                Ok(p) => {
                    self.instances.insert(i, p);
                }
                Err(e) if e.is::<TimedOut>() => {
                    self.reset();
                    return Err(failed(&id, &e));
                }
                Err(e) => return Err(format!("プラグイン「{id}」の起動に失敗しました：{e}")),
            }
        }
        let plugin = &self.instances[&i];
        let st = self.store.data_mut();
        st.files = vec![path.to_owned()];
        st.current = id.clone();
        st.index = i;
        let file = File {
            handle: 0,
            ext: ext.to_owned(),
            size,
        };
        let r = f(plugin, &mut self.store, format, file);
        self.store.data_mut().files.clear();
        r.map_err(|e| {
            self.reset();
            failed(&id, &e)
        })
    }

    /// 止まったプラグインを作り直す。止まったあとの store には入れないので、store から作り直す。
    fn reset(&mut self) {
        let reads = self.store.data_mut().reads.take();
        self.store = store(HostState::new(Some(Arc::clone(&self.reg))));
        self.store.data_mut().reads = reads;
        self.instances.clear();
    }

    /// f を呼び、そのあいだにプラグインが読んだ設定も返す。
    pub fn reading<R>(&mut self, f: impl FnOnce(&mut Runner) -> R) -> (R, Reads) {
        self.store.data_mut().reads = Some(Reads::new());
        let r = f(self);
        (r, self.store.data_mut().reads.take().unwrap_or_default())
    }

    /// サムネイルの PNG と、素材そのものの大きさ。受け持つプラグインがない、または作らなかったときは None。
    pub fn thumbnail(&mut self, ext: &str, path: &Path, edge: u32) -> Result<Option<Made>, String> {
        let (t, reads) = self.reading(|r| {
            r.call(
                ext,
                Part::Thumbnail,
                By::Wasm,
                path,
                THUMBNAIL_LIMIT,
                |p, s, fmt, file| p.call_thumbnail(s, fmt, &file, edge),
            )
        });
        let t = t.unwrap_or(Ok(Ok(None)))??;
        Ok(t.map(|t| (t.png, t.size.map(|d| (d.width, d.height)), reads)))
    }

    /// 詳細に出すもの。受け持つプラグインがない、または出さないときは None。
    pub fn view(&mut self, ext: &str, path: &Path) -> Option<ViewOut> {
        if let Some(ui) = self.reg.ui_of(ext, Part::View) {
            return Some(ViewOut::Ui(ui));
        }
        let r = self.call(
            ext,
            Part::View,
            By::Wasm,
            path,
            VIEW_LIMIT,
            |p, s, fmt, file| p.call_view(s, fmt, &file),
        )?;
        let v = match r {
            Ok(v) => v?,
            Err(e) => {
                log::warn!("詳細に出すものを決められない: {}: {e}", path.display());
                return None;
            }
        };
        Some(match v {
            types::View::Image => ViewOut::Image,
            types::View::Video => ViewOut::Video,
            types::View::Audio => ViewOut::Audio,
            types::View::Decoded => ViewOut::Decoded,
        })
    }

    /// 詳細に出す PNG。view が decoded を返した形式で使う。
    pub fn decode(&mut self, ext: &str, path: &Path) -> Result<Vec<u8>, String> {
        self.call(
            ext,
            Part::View,
            By::Wasm,
            path,
            VIEW_LIMIT,
            |p, s, fmt, file| p.call_decode(s, fmt, &file),
        )
        .ok_or("詳細表示に対応するプラグインがありません")??
    }

    /// part を受け持つ組み込み UI から、そのプラグインの WASM の関数を呼ぶ。
    /// target があれば、そのプラグインのものを呼ぶ。呼べるのは、使っていて版の下限を満たす依存先だけ。
    /// format は組み込み UI のプラグインのものをそのまま渡す。
    pub fn call_ui(
        &mut self,
        ext: &str,
        part: Part,
        path: &Path,
        target: Option<&str>,
        method: &str,
        args: &str,
    ) -> Result<String, String> {
        let (i, format) = self
            .reg
            .part(ext, part, By::Ui)
            .ok_or("UI ファイルで対応するプラグインがありません")?;
        let format = format.to_owned();
        let i = match target {
            None => i,
            Some(t) => self
                .reg
                .reachable(i)
                .into_iter()
                .map(|(q, _)| q)
                .find(|&q| self.reg.plugins[q].manifest.id == t)
                .ok_or_else(|| {
                    format!("プラグイン「{t}」は依存先ではないか、有効でないため呼べません")
                })?,
        };
        // 読んだ設定はサムネイルを受け持つプラグインのものとして残すので、依存先が読んだものは残さない
        let reads = target.and_then(|_| self.store.data_mut().reads.take());
        let r = self.run(i, &format, ext, path, VIEW_LIMIT, |p, s, fmt, file| {
            p.call_call(s, fmt, &file, method, args)
        });
        if reads.is_some() {
            self.store.data_mut().reads = reads;
        }
        r?
    }
}
