use std::collections::HashMap;
use std::fs::{self, File as FsFile};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use wasmtime::component::{
    Component, ComponentExportIndex, ComponentNamedList, Instance, InstancePre, Lift, Linker,
    Lower, Resource, ResourceTable, TypedFunc,
};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder, UpdateDeadline};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use super::{
    By, Choice, Manifest, Part, Reads, Registry, SettingDecl, SettingKind, UiRef, commands,
};
use crate::{embed, library, search, thumb};

// 役割ごとの export は WASM によってあったりなかったりするので、world 全体の型と import だけを使い、export は名前で呼ぶ
wasmtime::component::bindgen!({ world: "full", path: "../plugins/sdk/wit" });

use patchouli::plugin::commands::{CommandArg, CommandOutput};
use patchouli::plugin::types::{self, File, MenuOutput, Read as ReadProof, Run as RunProof};
pub use patchouli::plugin::types::{ContentBudget, ContentMedia, ContentPart};

/// plugin.wit の package の版と合わせる。
const WIT_VERSION: (u64, u64, u64) = (0, 12, 0);

pub const READ_MAX: u32 = 16 << 20;

/// 役割ごとの上限。time は WASM が続けて動いてよい長さで、外部ツールを動かしている時間は数えない。
/// memory は線形メモリ 1 つの大きさ（バイト）で、超えて増やそうとすると止める。
#[derive(Debug, Clone, Copy)]
struct Budget {
    time: Duration,
    memory: usize,
}

const SETTINGS_LIMIT: Budget = Budget {
    time: Duration::from_secs(2),
    memory: 64 << 20,
};
const THUMBNAIL_LIMIT: Budget = Budget {
    time: Duration::from_secs(10),
    memory: 1 << 30,
};
const VIEW_LIMIT: Budget = Budget {
    time: Duration::from_secs(30),
    memory: 2 << 30,
};
const DETAILS_LIMIT: Budget = Budget {
    time: Duration::from_secs(30),
    memory: 1 << 30,
};
const MENU_LIMIT: Budget = Budget {
    time: Duration::from_secs(30),
    memory: 1 << 30,
};
const CALL_LIMIT: Budget = Budget {
    time: Duration::from_secs(30),
    memory: 1 << 30,
};
const CONTENT_LIMIT: Budget = Budget {
    time: Duration::from_secs(120),
    memory: 1 << 30,
};
const HOOK_LIMIT: Budget = Budget {
    time: Duration::from_secs(60),
    memory: 1 << 30,
};

/// 1 つの Store に入れてよいインスタンス・テーブル・メモリの数。Store にはプラグインをいくつも入れる。
const STORE_ITEMS: usize = 1000;

/// WASM が返すバイト列（サムネイル・decode・content・call）の上限。
const OUTPUT_MAX: usize = 256 << 20;

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

#[derive(Debug)]
struct TimedOut(Duration);

impl std::fmt::Display for TimedOut {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} 秒以内に終わりませんでした", self.0.as_secs())
    }
}

impl std::error::Error for TimedOut {}

#[derive(Debug)]
struct Stopped;

impl std::fmt::Display for Stopped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "止めました")
    }
}

impl std::error::Error for Stopped {}

fn store(state: HostState) -> Store<HostState> {
    let mut store = Store::new(engine(), state);
    store.limiter(|s| &mut s.limits);
    store.epoch_deadline_callback(|s| {
        let st = s.data();
        if st.stopping() {
            return Err(wasmtime::Error::new(Stopped));
        }
        if st.started.elapsed().saturating_sub(st.outside) > st.limit {
            return Err(wasmtime::Error::new(TimedOut(st.limit)));
        }
        Ok(UpdateDeadline::Continue(1))
    });
    store
}

fn limits(memory: usize) -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(memory)
        .instances(STORE_ITEMS)
        .tables(STORE_ITEMS)
        .memories(STORE_ITEMS)
        .trap_on_grow_failure(true)
        .build()
}

fn start(store: &mut Store<HostState>, budget: Budget) {
    let st = store.data_mut();
    st.limit = budget.time;
    st.limits = limits(budget.memory);
    st.started = Instant::now();
    st.outside = Duration::ZERO;
    store.set_epoch_deadline(1);
}

fn failed(id: &str, e: &wasmtime::Error) -> String {
    match e.downcast_ref::<TimedOut>() {
        Some(t) => format!(
            "プラグイン「{id}」の処理が {} 秒以内に終わらなかったため、停止しました",
            t.0.as_secs()
        ),
        None => format!("{id}: {e}"),
    }
}

/// ライブラリが持つ情報。permissions に library を書いたプラグインに渡す。
#[derive(Debug, Clone)]
pub struct ItemInfo {
    pub id: String,
    pub name: String,
    pub note: bool,
    pub project: Option<String>,
    pub tags: Vec<String>,
    pub memo: String,
}

impl ItemInfo {
    fn to_wit(&self) -> types::ItemInfo {
        types::ItemInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            note: self.note,
            project: self.project.clone(),
            tags: self.tags.clone(),
            memo: self.memo.clone(),
        }
    }
}

/// 右クリックメニューやフックに渡すもの 1 つ。ext はノートなら md。
pub struct TargetFile<'a> {
    pub ext: &'a str,
    pub note: bool,
    pub path: &'a Path,
    pub info: Option<ItemInfo>,
}

/// ID からライブラリの情報を引く。
pub type Lookup = Arc<dyn Fn(&str) -> Option<ItemInfo> + Send + Sync>;

/// library・embed がライブラリを引く窓口。
pub struct Env {
    /// embed を使えるか。AI 機能が有効で、モデルが入っているとき。
    pub ai: bool,
    /// 内容での検索の索引がある場所（サムネイルの置き場）。
    pub thumbs: PathBuf,
    pub info: Lookup,
}

/// 証明を渡す呼び出しの種類。使える関数が変わる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Context {
    Menu,
    Hook,
}

/// run-menu の結果の出し方。
pub enum MenuShown {
    None,
    Toast {
        text: String,
        level: &'static str,
    },
    Overlay {
        title: Option<String>,
        rows: Vec<(String, String)>,
    },
    Screen {
        id: String,
        window: bool,
    },
}

/// run-menu・added の中で頼まれ、終わってからアプリが起こすこと。target は渡したものの順番。
pub enum Action {
    Copy(String),
    Note { name: String, body: String },
    Asset { path: PathBuf, name: Option<String> },
    Body { target: usize, body: String },
    Rename { target: usize, name: String },
    Tags { target: usize, tags: Vec<String> },
    Replace { target: usize, path: PathBuf },
    Export { path: PathBuf, name: String },
}

pub struct MenuRun {
    pub shown: MenuShown,
    pub ran: Ran,
}

/// 頼まれたこと。
pub struct Ran {
    pub actions: Vec<Action>,
    /// assets・export で用意したファイルの置き場。起こし終えるまで持っておく。
    pub scratch: Option<Scratch>,
}

/// assets の create で用意したファイルの置き場。手放すと消す。
pub struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(e) = fs::remove_dir_all(&self.0) {
            log::warn!(
                "プラグインの作業用フォルダを消せない: {}: {e}",
                self.0.display()
            );
        }
    }
}

pub struct HostState {
    wasi: WasiCtx,
    table: ResourceTable,
    files: Vec<PathBuf>,
    /// files と同じ順の、ライブラリの情報。
    items: Vec<Option<ItemInfo>>,
    /// files の頭からこの数だけが targets。
    targets: usize,
    context: Context,
    env: Option<Arc<Env>>,
    created: Vec<u32>,
    added: Vec<u32>,
    exported: Option<u32>,
    actions: Vec<Action>,
    scratch: Option<Scratch>,
    current: String,
    index: usize,
    reg: Option<Arc<Registry>>,
    reads: Option<Reads>,
    started: Instant,
    limit: Duration,
    limits: StoreLimits,
    outside: Duration,
    stop: Option<Arc<AtomicBool>>,
}

impl HostState {
    fn new(reg: Option<Arc<Registry>>) -> HostState {
        // 環境変数・ファイル・ネットワークは何も渡さない
        HostState {
            wasi: WasiCtx::builder().build(),
            table: ResourceTable::new(),
            files: Vec::new(),
            items: Vec::new(),
            targets: 0,
            context: Context::Menu,
            env: None,
            created: Vec::new(),
            added: Vec::new(),
            exported: None,
            actions: Vec::new(),
            scratch: None,
            current: String::new(),
            index: 0,
            reg,
            reads: None,
            started: Instant::now(),
            limit: Duration::ZERO,
            limits: limits(SETTINGS_LIMIT.memory),
            outside: Duration::ZERO,
            stop: None,
        }
    }

    /// 止めるよう頼まれたか。プラグインを読み直すときは、Registry ごと止める。
    fn stopping(&self) -> bool {
        self.stop
            .as_ref()
            .is_some_and(|s| s.load(Ordering::Relaxed))
            || self.reg.as_ref().is_some_and(|r| r.stopped())
    }

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

    fn created(&self, f: &File) -> Result<&Path, String> {
        if !self.created.contains(&f.handle) {
            return Err("assets の create で用意したファイルではありません".into());
        }
        self.path(f)
    }

    fn path(&self, f: &File) -> Result<&Path, String> {
        self.files
            .get(f.handle as usize)
            .map(PathBuf::as_path)
            .ok_or_else(|| "プラグインに渡されていないファイルです".into())
    }

    /// targets の何番目か。
    fn target(&self, f: &File) -> Result<usize, String> {
        let i = f.handle as usize;
        if i < self.targets {
            Ok(i)
        } else {
            Err("targets のファイルではありません".into())
        }
    }

    fn note_target(&self, f: &File) -> Result<usize, String> {
        let i = self.target(f)?;
        match self.items.get(i).and_then(Option::as_ref) {
            Some(it) if it.note => Ok(i),
            _ => Err("ノートではありません".into()),
        }
    }

    fn asset_target(&self, f: &File) -> Result<usize, String> {
        let i = self.target(f)?;
        match self.items.get(i).and_then(Option::as_ref) {
            Some(it) if !it.note => Ok(i),
            _ => Err("素材ではありません".into()),
        }
    }

    fn menu_only(&self, what: &str) -> Result<(), String> {
        match self.context {
            Context::Menu => Ok(()),
            Context::Hook => Err(format!("{what}は、取り込みのフックの中では使えません")),
        }
    }

    /// 作業用の置き場に、空のファイルを用意する。
    fn scratch_file(&mut self, name: &str) -> Result<File, String> {
        library::check_name(name)?;
        let dir = match &self.scratch {
            Some(s) => s.0.clone(),
            None => {
                let dir = std::env::temp_dir()
                    .join("patchouli-plugin")
                    .join(uuid::Uuid::new_v4().simple().to_string());
                fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
                self.scratch = Some(Scratch(dir.clone()));
                dir
            }
        };
        let path = dir.join(name);
        FsFile::create_new(&path).map_err(|e| format!("「{name}」を用意できません：{e}"))?;
        let ext = path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let handle = u32::try_from(self.files.len()).map_err(|e| e.to_string())?;
        self.files.push(path);
        Ok(File {
            handle,
            ext,
            size: 0,
        })
    }

    fn env(&self) -> Result<&Env, String> {
        self.env
            .as_deref()
            .ok_or_else(|| "いまはライブラリを読めません".into())
    }

    fn ai(&self) -> Result<&Env, String> {
        let env = self.env()?;
        if !env.ai {
            return Err("AI 機能が無効か、モデルが入っていないため、embed を使えません".into());
        }
        Ok(env)
    }
}

fn append(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut file, data).map_err(|e| e.to_string())
}

impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

// 証明は呼び出しの中だけで借りて渡すので、持ち主として手放されることはない
impl types::HostRead for HostState {
    fn drop(&mut self, _: Resource<ReadProof>) -> wasmtime::Result<()> {
        Ok(())
    }
}

impl types::HostRun for HostState {
    fn drop(&mut self, _: Resource<RunProof>) -> wasmtime::Result<()> {
        Ok(())
    }
}

impl types::Host for HostState {}

impl patchouli::plugin::commands::Host for HostState {
    fn available(&mut self, name: String) -> bool {
        self.command(&name).is_ok()
    }

    fn run(
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
        let timeout = timeout_ms
            .map_or(commands::TIMEOUT, |ms| {
                std::time::Duration::from_millis(u64::from(ms))
            })
            .min(commands::TIMEOUT_MAX);
        let begun = Instant::now();
        let out = commands::run(&path, &args, timeout, || self.stopping());
        self.outside += begun.elapsed();
        let out = out?;
        Ok(CommandOutput {
            code: out.code,
            stdout: out.stdout,
            stderr: out.stderr,
        })
    }
}

impl patchouli::plugin::host::Host for HostState {
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

impl patchouli::plugin::library::Host for HostState {
    fn item(&mut self, _: Resource<ReadProof>, f: File) -> Result<types::ItemInfo, String> {
        self.items
            .get(f.handle as usize)
            .and_then(Option::as_ref)
            .map(ItemInfo::to_wit)
            .ok_or_else(|| "ライブラリの項目ではないファイルです".into())
    }
}

impl patchouli::plugin::clipboard::Host for HostState {
    fn copy(&mut self, _: Resource<RunProof>, text: String) {
        match self.menu_only("clipboard") {
            Ok(()) => self.actions.push(Action::Copy(text)),
            Err(e) => log::warn!("[{}] {e}", self.current),
        }
    }
}

impl patchouli::plugin::notes::Host for HostState {
    fn create(&mut self, _: Resource<RunProof>, name: String, body: String) -> Result<(), String> {
        library::check_name(&name)?;
        self.actions.push(Action::Note { name, body });
        Ok(())
    }

    fn set_body(&mut self, _: Resource<RunProof>, f: File, body: String) -> Result<(), String> {
        let target = self.note_target(&f)?;
        self.actions.push(Action::Body { target, body });
        Ok(())
    }
}

impl patchouli::plugin::edit::Host for HostState {
    fn rename(&mut self, _: Resource<RunProof>, f: File, name: String) -> Result<(), String> {
        let target = self.target(&f)?;
        library::check_name(&name)?;
        self.actions.push(Action::Rename { target, name });
        Ok(())
    }

    fn set_tags(
        &mut self,
        _: Resource<RunProof>,
        f: File,
        tags: Vec<String>,
    ) -> Result<(), String> {
        let target = self.target(&f)?;
        let mut out: Vec<String> = Vec::new();
        for t in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            if !out.iter().any(|x| x == t) {
                out.push(t.to_owned());
            }
        }
        self.actions.push(Action::Tags { target, tags: out });
        Ok(())
    }
}

impl patchouli::plugin::assets::Host for HostState {
    fn create(&mut self, _: Resource<RunProof>, name: String) -> Result<File, String> {
        let f = self.scratch_file(&name)?;
        self.created.push(f.handle);
        Ok(f)
    }

    fn write(&mut self, _: Resource<RunProof>, f: File, data: Vec<u8>) -> Result<(), String> {
        append(self.created(&f)?, &data)
    }

    fn add(&mut self, _: Resource<RunProof>, f: File, name: Option<String>) -> Result<(), String> {
        let path = self.created(&f)?.to_owned();
        if self.added.contains(&f.handle) {
            return Err("このファイルはすでに登録しています".into());
        }
        if let Some(n) = &name {
            library::check_name(n)?;
        }
        self.added.push(f.handle);
        self.actions.push(Action::Asset { path, name });
        Ok(())
    }

    fn replace(&mut self, _: Resource<RunProof>, target: File, source: File) -> Result<(), String> {
        let target = self.asset_target(&target)?;
        let path = self.created(&source)?.to_owned();
        if self.added.contains(&source.handle) {
            return Err("このファイルはすでに使っています".into());
        }
        self.added.push(source.handle);
        self.actions.push(Action::Replace { target, path });
        Ok(())
    }
}

impl patchouli::plugin::export::Host for HostState {
    fn create(&mut self, _: Resource<RunProof>, name: String) -> Result<File, String> {
        self.menu_only("export")?;
        if self.exported.is_some() {
            return Err(
                "書き出せるのは 1 つのファイルだけです。複数あるときは zip などにまとめてください"
                    .into(),
            );
        }
        let f = self.scratch_file(&name)?;
        self.exported = Some(f.handle);
        let path = self.path(&f)?.to_owned();
        self.actions.push(Action::Export { path, name });
        Ok(f)
    }

    fn write(&mut self, _: Resource<RunProof>, f: File, data: Vec<u8>) -> Result<(), String> {
        if self.exported != Some(f.handle) {
            return Err("export の create で用意したファイルではありません".into());
        }
        append(self.path(&f)?, &data)
    }
}

impl patchouli::plugin::embed::Host for HostState {
    fn available(&mut self) -> bool {
        self.ai().is_ok()
    }

    fn text(&mut self, _: Resource<ReadProof>, s: String) -> Result<Vec<f32>, String> {
        self.ai()?;
        let begun = Instant::now();
        let v = embed::text("sentence similarity", &s);
        self.outside += begun.elapsed();
        v
    }

    fn similar(
        &mut self,
        _: Resource<ReadProof>,
        s: String,
        limit: u32,
    ) -> Result<Vec<types::SimilarItem>, String> {
        let env = self.ai()?;
        let begun = Instant::now();
        let hits = search::similar(&env.thumbs, &s, limit as usize);
        let out = hits.map(|hs| {
            hs.into_iter()
                .filter_map(|(id, score)| {
                    Some(types::SimilarItem {
                        info: (env.info)(&id)?.to_wit(),
                        score,
                    })
                })
                .collect()
        });
        self.outside += begun.elapsed();
        out
    }
}

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

static COMPILED: OnceLock<PathBuf> = OnceLock::new();

/// コンパイルしたものを残す場所。決めなければ、毎回コンパイルする。
pub fn set_compiled_dir(dir: PathBuf) {
    let _ = COMPILED.set(dir);
}

/// 同じ WASM と実行環境なら、前にコンパイルしたものを読む。古いものや壊れたものは作り直す。
fn component(engine: &Engine, wasm: &[u8]) -> Result<Component, String> {
    let Some(dir) = COMPILED.get() else {
        return Component::new(engine, wasm).map_err(|e| e.to_string());
    };
    let mut env = std::hash::DefaultHasher::new();
    std::hash::Hash::hash(&engine.precompile_compatibility_hash(), &mut env);
    let env = std::hash::Hasher::finish(&env);
    // ファイルの頭に鍵を書いておき、別の WASM から作ったものを読まないようにする
    let key: [u8; 32] = Sha256::new()
        .chain_update(wasm)
        .chain_update(env.to_le_bytes())
        .finalize()
        .into();
    let name: String = key[..8].iter().map(|b| format!("{b:02x}")).collect();
    let path = dir.join(format!("{name}.cwasm"));
    if let Ok(saved) = fs::read(&path) {
        match saved.strip_prefix(&key[..]) {
            // 自分で書いたファイルだけを読む。合わない環境で作ったものは、ここで失敗する
            Some(body) => match unsafe { Component::deserialize(engine, body) } {
                Ok(c) => return Ok(c),
                Err(e) => log::warn!("コンパイル済みの WASM を読めない: {}: {e}", path.display()),
            },
            None => log::warn!("コンパイル済みの WASM の鍵が合わない: {}", path.display()),
        }
    }
    let bytes = engine
        .precompile_component(wasm)
        .map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    let saved = fs::create_dir_all(dir)
        .and_then(|_| fs::write(&tmp, [&key[..], &bytes].concat()))
        .and_then(|_| fs::rename(&tmp, &path));
    if let Err(e) = saved {
        log::warn!("コンパイルした WASM を残せない: {}: {e}", path.display());
    }
    unsafe { Component::deserialize(engine, &bytes) }.map_err(|e| e.to_string())
}

/// WASM が受け持つ役割。plugin.wit の役割ごとの world と合わせる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Thumbnail,
    View,
    Details,
    Content,
    Menu,
    Hook,
    Settings,
    Call,
}

/// 役割ごとに export する interface と、その中の関数。
const ROLES: [(Role, &str, &[&str]); 8] = [
    (Role::Thumbnail, "thumbnail", &["thumbnail"]),
    (Role::View, "view", &["view", "decode"]),
    (Role::Details, "details", &["details"]),
    (Role::Content, "content", &["content"]),
    (Role::Menu, "menu", &["menu", "run-menu"]),
    (Role::Hook, "hook", &["added"]),
    (Role::Settings, "settings", &["settings"]),
    (Role::Call, "call", &["call"]),
];

impl Role {
    /// plugin.json の formats で sandbox を true にした形式に受け持たせるもの。
    pub fn part(self) -> Option<Part> {
        match self {
            Role::Thumbnail => Some(Part::Thumbnail),
            Role::View => Some(Part::View),
            Role::Details => Some(Part::Details),
            Role::Content => Some(Part::Content),
            Role::Menu | Role::Hook | Role::Settings | Role::Call => None,
        }
    }
}

/// 関数の名前ごとの、export の場所。
type Funcs = HashMap<&'static str, ComponentExportIndex>;

fn roles_of(engine: &Engine, component: &Component) -> Result<(Vec<Role>, Funcs), String> {
    let mut roles = Vec::new();
    let mut funcs = HashMap::new();
    let ty = component.component_type();
    for (name, _) in ty.exports(engine) {
        let Some(rest) = name.strip_prefix("patchouli:plugin/") else {
            continue;
        };
        check_version(rest)?;
        let iface = rest.split('@').next().unwrap_or(rest);
        let Some(&(role, _, fs)) = ROLES.iter().find(|(_, n, _)| *n == iface) else {
            continue;
        };
        let Some(at) = component.get_export_index(None, name) else {
            continue;
        };
        for &f in fs {
            let i = component
                .get_export_index(Some(&at), f)
                .ok_or_else(|| format!("{iface} の {f} が見つかりません"))?;
            funcs.insert(f, i);
        }
        roles.push(role);
    }
    Ok((roles, funcs))
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.split('.').map(|x| x.parse::<u64>().ok());
    let r = (it.next()??, it.next()??, it.next()??);
    it.next().is_none().then_some(r)
}

/// 同じマイナー版（1.0 からは同じメジャー版）で、アプリの版以下のものだけを読む。
fn check_version(name: &str) -> Result<(), String> {
    let (hm, hn, hp) = WIT_VERSION;
    let host = format!("{hm}.{hn}.{hp}");
    let v = name.split_once('@').map_or("", |(_, v)| v);
    let Some((m, n, p)) = parse_version(v) else {
        return Err(format!("プラグインの SDK の版（{v}）を読めません"));
    };
    let compatible = m == hm && (m > 0 || n == hn);
    if compatible && (m, n, p) <= WIT_VERSION {
        Ok(())
    } else if (m, n, p) > WIT_VERSION {
        Err(format!(
            "プラグインの SDK の版（{v}）がアプリ（{host}）より新しいため、読み込めません。アプリを更新してください"
        ))
    } else {
        Err(format!(
            "プラグインの SDK の版（{v}）がアプリ（{host}）と互換でないため、読み込めません。今の SDK で作り直してください"
        ))
    }
}

pub struct Prepared {
    pre: InstancePre<HostState>,
    roles: Vec<Role>,
    funcs: Arc<Funcs>,
}

impl Prepared {
    /// commands は required / optional にコマンドを書いたときだけ、ほかは permissions に書いたものだけを渡す。
    /// 渡さないものを使う WASM は読み込まない。
    pub fn new(wasm: &[u8], m: &Manifest) -> Result<Prepared, String> {
        use patchouli::plugin::{
            assets, clipboard, commands, edit, embed, export, host, library, notes, types,
        };
        use wasmtime::component::HasSelf;
        let engine = engine();
        let component = component(engine, wasm)?;
        let commands_ok = !m.required.commands.is_empty() || !m.optional.commands.is_empty();
        let has = |p: &str| m.permissions.iter().any(|x| x == p);
        let mut missing = Vec::new();
        for (name, _) in component.component_type().imports(engine) {
            let Some(rest) = name.strip_prefix("patchouli:plugin/") else {
                continue;
            };
            check_version(rest)?;
            let iface = rest.split('@').next().unwrap_or(rest);
            if iface == "commands" && !commands_ok {
                return Err(
                    "plugin.json の required・optional に commands を書いていないため、コマンドを動かせません"
                        .into(),
                );
            }
            if super::rules().permitted(iface) && !has(iface) {
                missing.push(iface.to_owned());
            }
        }
        if !missing.is_empty() {
            return Err(format!(
                "plugin.json の permissions に「{}」を書いていないため、使えません",
                missing.join("」「")
            ));
        }
        let (roles, funcs) = roles_of(engine, &component)?;
        let mut linker = Linker::new(engine);
        let e = |e: wasmtime::Error| e.to_string();
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker).map_err(e)?;
        types::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        host::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        if commands_ok {
            commands::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("library") {
            library::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("clipboard") {
            clipboard::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("notes") {
            notes::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("edit") {
            edit::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("assets") {
            assets::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("export") {
            export::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        if has("embed") {
            embed::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s).map_err(e)?;
        }
        let pre = linker
            .instantiate_pre(&component)
            .map_err(|e| e.to_string())?;
        Ok(Prepared {
            pre,
            roles,
            funcs: Arc::new(funcs),
        })
    }

    pub fn has(&self, role: Role) -> bool {
        self.roles.contains(&role)
    }

    /// formats で sandbox を true にした形式に受け持たせるもの。
    pub fn parts(&self) -> impl Iterator<Item = Part> + '_ {
        self.roles.iter().filter_map(|r| r.part())
    }

    fn instantiate(&self, store: &mut Store<HostState>) -> wasmtime::Result<Plugin> {
        let inst = self.pre.instantiate(store)?;
        Ok(Plugin {
            inst,
            funcs: Arc::clone(&self.funcs),
        })
    }

    pub fn settings(&self, id: &str) -> Result<Vec<SettingDecl>, String> {
        if !self.has(Role::Settings) {
            return Ok(Vec::new());
        }
        let mut store = store(HostState::new(None));
        store.data_mut().current = id.to_owned();
        start(&mut store, SETTINGS_LIMIT);
        let p = self.instantiate(&mut store).map_err(|e| failed(id, &e))?;
        let list = p.call_settings(&mut store).map_err(|e| failed(id, &e))?;
        Ok(list.into_iter().map(decl).collect())
    }
}

/// 動かしている WASM。役割ごとの export を名前で呼ぶ。
struct Plugin {
    inst: Instance,
    funcs: Arc<Funcs>,
}

impl Plugin {
    fn func<P, R>(&self, s: &mut Store<HostState>, name: &str) -> wasmtime::Result<TypedFunc<P, R>>
    where
        P: ComponentNamedList + Lower,
        R: ComponentNamedList + Lift,
    {
        let at = self
            .funcs
            .get(name)
            .ok_or_else(|| wasmtime::format_err!("{name} を export していません"))?;
        self.inst.get_typed_func::<P, R>(&mut *s, at)
    }

    fn call_thumbnail(
        &self,
        s: &mut Store<HostState>,
        fmt: &str,
        f: &File,
        edge: u32,
    ) -> wasmtime::Result<Result<Option<types::ThumbnailImage>, String>> {
        let (r,): (Result<Option<types::ThumbnailImage>, String>,) = self
            .func::<(&str, &File, u32), _>(s, "thumbnail")?
            .call(&mut *s, (fmt, f, edge))?;
        Ok(r.and_then(|t| {
            within(t.as_ref().map_or(0, |t| t.png.len()))?;
            Ok(t)
        }))
    }

    fn call_view(
        &self,
        s: &mut Store<HostState>,
        fmt: &str,
        f: &File,
    ) -> wasmtime::Result<Option<types::ViewKind>> {
        let (r,) = self
            .func::<(&str, &File), _>(s, "view")?
            .call(&mut *s, (fmt, f))?;
        Ok(r)
    }

    fn call_decode(
        &self,
        s: &mut Store<HostState>,
        fmt: &str,
        f: &File,
    ) -> wasmtime::Result<Result<Vec<u8>, String>> {
        let (r,): (Result<Vec<u8>, String>,) = self
            .func::<(&str, &File), _>(s, "decode")?
            .call(&mut *s, (fmt, f))?;
        Ok(r.and_then(|b| within(b.len()).map(|()| b)))
    }

    fn call_details(
        &self,
        s: &mut Store<HostState>,
        fmt: &str,
        f: &File,
    ) -> wasmtime::Result<Result<Vec<types::Detail>, String>> {
        let (r,) = self
            .func::<(&str, &File), _>(s, "details")?
            .call(&mut *s, (fmt, f))?;
        Ok(r)
    }

    fn call_content(
        &self,
        s: &mut Store<HostState>,
        fmt: &str,
        f: &File,
        budget: ContentBudget,
    ) -> wasmtime::Result<Result<Vec<ContentPart>, String>> {
        let (r,): (Result<Vec<ContentPart>, String>,) = self
            .func::<(&str, &File, ContentBudget), _>(s, "content")?
            .call(&mut *s, (fmt, f, budget))?;
        Ok(r.and_then(|ps| within(ps.iter().map(content_size).sum()).map(|()| ps)))
    }

    fn call_menu(
        &self,
        s: &mut Store<HostState>,
        read: Resource<ReadProof>,
        targets: &[types::Target],
    ) -> wasmtime::Result<Result<Vec<types::MenuItem>, String>> {
        let (r,) = self
            .func::<(Resource<ReadProof>, &[types::Target]), _>(s, "menu")?
            .call(&mut *s, (read, targets))?;
        Ok(r)
    }

    fn call_run_menu(
        &self,
        s: &mut Store<HostState>,
        read: Resource<ReadProof>,
        run: Resource<RunProof>,
        targets: &[types::Target],
        id: &str,
    ) -> wasmtime::Result<Result<MenuOutput, String>> {
        let (r,) = self
            .func::<(
                Resource<ReadProof>,
                Resource<RunProof>,
                &[types::Target],
                &str,
            ), _>(s, "run-menu")?
            .call(&mut *s, (read, run, targets, id))?;
        Ok(r)
    }

    fn call_added(
        &self,
        s: &mut Store<HostState>,
        read: Resource<ReadProof>,
        run: Resource<RunProof>,
        target: &types::Target,
    ) -> wasmtime::Result<Result<(), String>> {
        let (r,) = self
            .func::<(Resource<ReadProof>, Resource<RunProof>, &types::Target), _>(s, "added")?
            .call(&mut *s, (read, run, target))?;
        Ok(r)
    }

    fn call_settings(&self, s: &mut Store<HostState>) -> wasmtime::Result<Vec<types::Setting>> {
        let (r,) = self.func::<(), _>(s, "settings")?.call(&mut *s, ())?;
        Ok(r)
    }

    fn call_call(
        &self,
        s: &mut Store<HostState>,
        fmt: &str,
        f: &File,
        method: &str,
        args: &str,
    ) -> wasmtime::Result<Result<String, String>> {
        let (r,): (Result<String, String>,) = self
            .func::<(&str, &File, &str, &str), _>(s, "call")?
            .call(&mut *s, (fmt, f, method, args))?;
        Ok(r.and_then(|x| within(x.len()).map(|()| x)))
    }
}

fn within(len: usize) -> Result<(), String> {
    if len > OUTPUT_MAX {
        Err(format!(
            "プラグインが返したデータが大きすぎます（{} MB まで）",
            OUTPUT_MAX >> 20
        ))
    } else {
        Ok(())
    }
}

fn content_size(p: &ContentPart) -> usize {
    match &p.media {
        ContentMedia::Images(l) => l.iter().map(Vec::len).sum(),
        ContentMedia::Audio(b) => b.len(),
        ContentMedia::Text(t) => t.len(),
    }
}

pub type Made = (Vec<u8>, Option<(u32, u32)>, Reads);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ViewOut {
    Image,
    Video,
    Audio,
    Decoded,
    Ui(UiRef),
    /// ファイルが指す URL を画面に読んでもらい、URL ごとに受け持つものが描く。中は link を受け持つもの。
    Link(UiRef),
}

/// elevated から WASM を呼ぶときに、どのプラグインのものかを決める元。
pub enum UiOwner<'a> {
    /// 拡張子の part を受け持つもの。
    Format(Part),
    /// 右クリックメニューのプラグイン。
    Menu { plugin: &'a str, note: bool },
}

pub struct Runner {
    reg: Arc<Registry>,
    store: Store<HostState>,
    instances: HashMap<usize, Plugin>,
    env: Option<Arc<Env>>,
}

impl Runner {
    pub fn new(reg: Arc<Registry>) -> Runner {
        Runner {
            store: store(HostState::new(Some(Arc::clone(&reg)))),
            reg,
            instances: HashMap::new(),
            env: None,
        }
    }

    pub fn registry(&self) -> &Arc<Registry> {
        &self.reg
    }

    fn call<R>(
        &mut self,
        ext: &str,
        part: Part,
        by: By,
        path: &Path,
        limit: Budget,
        f: impl FnOnce(&Plugin, &mut Store<HostState>, &str, File) -> wasmtime::Result<R>,
    ) -> Option<Result<R, String>> {
        let (i, format) = self.reg.slot(ext, part, by)?;
        let format = format.to_owned();
        Some(self.run(i, &format, ext, path, limit, f))
    }

    fn run<R>(
        &mut self,
        i: usize,
        format: &str,
        ext: &str,
        path: &Path,
        limit: Budget,
        f: impl FnOnce(&Plugin, &mut Store<HostState>, &str, File) -> wasmtime::Result<R>,
    ) -> Result<R, String> {
        self.run_files(i, &[(ext, path)], limit, |p, s, mut files| {
            f(p, s, format, files.remove(0))
        })
    }

    /// files の順に handle を 0 から振って渡す。
    fn run_files<R>(
        &mut self,
        i: usize,
        files: &[(&str, &Path)],
        limit: Budget,
        f: impl FnOnce(&Plugin, &mut Store<HostState>, Vec<File>) -> wasmtime::Result<R>,
    ) -> Result<R, String> {
        let id = self.reg.plugins[i].manifest.id.clone();
        start(&mut self.store, limit);
        // 初期化の中からホストの関数を呼ぶものもあるので、どのプラグインかは起動する前に決める
        let st = self.store.data_mut();
        st.files = files.iter().map(|(_, p)| p.to_path_buf()).collect();
        st.current = id.clone();
        st.index = i;
        if !self.instances.contains_key(&i) {
            let Some(pre) = self.reg.plugins[i].wasm.as_ref() else {
                self.store.data_mut().files.clear();
                return Err(format!("プラグイン「{id}」の plugin.wasm が見つかりません"));
            };
            match pre.instantiate(&mut self.store) {
                Ok(p) => {
                    self.instances.insert(i, p);
                }
                Err(e) => {
                    self.reset();
                    return Err(if e.is::<TimedOut>() {
                        failed(&id, &e)
                    } else {
                        format!("プラグイン「{id}」の起動に失敗しました：{e}")
                    });
                }
            }
        }
        let plugin = &self.instances[&i];
        let handles = files
            .iter()
            .zip(0u32..)
            .map(|((ext, path), handle)| File {
                handle,
                ext: (*ext).to_owned(),
                size: std::fs::metadata(path).map_or(0, |m| m.len()),
            })
            .collect();
        let r = f(plugin, &mut self.store, handles);
        self.store.data_mut().files.clear();
        r.map_err(|e| {
            self.reset();
            failed(&id, &e)
        })
    }

    /// 止まったプラグインを作り直す。止まったあとの store には入れないので、store から作り直す。
    fn reset(&mut self) {
        let reads = self.store.data_mut().reads.take();
        let stop = self.store.data_mut().stop.take();
        self.store = store(HostState::new(Some(Arc::clone(&self.reg))));
        self.store.data_mut().reads = reads;
        self.store.data_mut().stop = stop;
        self.instances.clear();
    }

    /// stop が立つと、動いている WASM を止める。
    pub fn set_stop(&mut self, stop: Arc<AtomicBool>) {
        self.store.data_mut().stop = Some(stop);
    }

    pub fn reading<R>(&mut self, f: impl FnOnce(&mut Runner) -> R) -> (R, Reads) {
        self.store.data_mut().reads = Some(Reads::new());
        let r = f(self);
        (r, self.store.data_mut().reads.take().unwrap_or_default())
    }

    pub fn thumbnail(&mut self, ext: &str, path: &Path, edge: u32) -> Result<Option<Made>, String> {
        let (t, reads) = self.reading(|r| {
            r.call(
                ext,
                Part::Thumbnail,
                By::Sandbox,
                path,
                THUMBNAIL_LIMIT,
                |p, s, fmt, file| p.call_thumbnail(s, fmt, &file, edge),
            )
        });
        let t = t.unwrap_or(Ok(Ok(None)))??;
        Ok(t.map(|t| (t.png, t.size.map(|d| (d.width, d.height)), reads)))
    }

    pub fn view(&mut self, ext: &str, path: &Path) -> Option<ViewOut> {
        if self.reg.by_link(ext, Part::View) {
            return self.reg.link_of(ext).map(ViewOut::Link);
        }
        if let Some(ui) = self.reg.ui_of(ext, Part::View) {
            return Some(ViewOut::Ui(ui));
        }
        let r = self.call(
            ext,
            Part::View,
            By::Sandbox,
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
            types::ViewKind::Image => ViewOut::Image,
            types::ViewKind::Video => ViewOut::Video,
            types::ViewKind::Audio => ViewOut::Audio,
            types::ViewKind::Decoded => ViewOut::Decoded,
        })
    }

    pub fn details(&mut self, ext: &str, path: &Path) -> Result<Vec<(String, String)>, String> {
        let r = self.call(
            ext,
            Part::Details,
            By::Sandbox,
            path,
            DETAILS_LIMIT,
            |p, s, fmt, file| p.call_details(s, fmt, &file),
        );
        let ds = r.unwrap_or(Ok(Ok(Vec::new())))??;
        Ok(ds.into_iter().map(|d| (d.label, d.value)).collect())
    }

    /// sandbox の content。受け持たなければ None。
    pub fn content(
        &mut self,
        ext: &str,
        path: &Path,
        budget: ContentBudget,
    ) -> Option<Result<Vec<ContentPart>, String>> {
        let r = self.call(
            ext,
            Part::Content,
            By::Sandbox,
            path,
            CONTENT_LIMIT,
            |p, s, fmt, file| p.call_content(s, fmt, &file, budget),
        )?;
        Some(r.and_then(|x| x))
    }

    /// files を targets として渡す。頼まれたことと作業用の置き場も返す。
    fn call_targets<R>(
        &mut self,
        i: usize,
        files: &[TargetFile],
        context: Context,
        limit: Budget,
        f: impl FnOnce(&Plugin, &mut Store<HostState>, Vec<types::Target>) -> wasmtime::Result<R>,
    ) -> Result<(R, Ran), String> {
        let paths: Vec<(&str, &Path)> = files.iter().map(|m| (m.ext, m.path)).collect();
        let st = self.store.data_mut();
        st.items = files.iter().map(|m| m.info.clone()).collect();
        st.targets = files.len();
        st.context = context;
        st.env.clone_from(&self.env);
        let r = self.run_files(i, &paths, limit, |p, s, handles| {
            let targets = files
                .iter()
                .zip(handles)
                .map(|(m, file)| types::Target {
                    format: m.ext.to_owned(),
                    file,
                })
                .collect();
            f(p, s, targets)
        });
        let st = self.store.data_mut();
        st.items.clear();
        st.targets = 0;
        st.env = None;
        st.created.clear();
        st.added.clear();
        st.exported = None;
        let ran = Ran {
            actions: std::mem::take(&mut st.actions),
            scratch: st.scratch.take(),
        };
        Ok((r?, ran))
    }

    fn menu_index(&self, plugin: &str, files: &[TargetFile]) -> Result<usize, String> {
        let i = self.reg.index_of(plugin)?;
        if !files.iter().all(|m| self.reg.menu_covers(i, m.ext, m.note)) {
            return Err(format!(
                "プラグイン「{plugin}」の右クリックメニューは、選んだものに対応していません"
            ));
        }
        Ok(i)
    }

    /// library・embed がライブラリを引く窓口を渡す。
    pub fn set_env(&mut self, env: Option<Arc<Env>>) {
        self.env = env;
    }

    pub fn menu(
        &mut self,
        plugin: &str,
        files: &[TargetFile],
    ) -> Result<Vec<(String, String)>, String> {
        let i = self.menu_index(plugin, files)?;
        let (items, _) = self.call_targets(i, files, Context::Menu, MENU_LIMIT, |p, s, ts| {
            p.call_menu(s, Resource::new_borrow(0), &ts)
        })?;
        Ok(items?.into_iter().map(|m| (m.id, m.label)).collect())
    }

    /// 失敗したときは、頼まれたことを捨てる。
    pub fn run_menu(
        &mut self,
        plugin: &str,
        files: &[TargetFile],
        id: &str,
    ) -> Result<MenuRun, String> {
        let i = self.menu_index(plugin, files)?;
        let (out, ran) = self.call_targets(i, files, Context::Menu, MENU_LIMIT, |p, s, ts| {
            p.call_run_menu(s, Resource::new_borrow(0), Resource::new_borrow(0), &ts, id)
        })?;
        let shown = match out? {
            MenuOutput::None => MenuShown::None,
            MenuOutput::Toast(t) => MenuShown::Toast {
                text: t.text,
                level: match t.level {
                    types::ToastLevel::Info => "info",
                    types::ToastLevel::Success => "success",
                    types::ToastLevel::Warning => "warning",
                    types::ToastLevel::Error => "error",
                },
            },
            MenuOutput::Overlay(o) => MenuShown::Overlay {
                title: o.title,
                rows: o.rows.into_iter().map(|d| (d.label, d.value)).collect(),
            },
            MenuOutput::Screen(s) => MenuShown::Screen {
                id: s.id,
                window: s.window,
            },
        };
        Ok(MenuRun { shown, ran })
    }

    /// 取り込んだもの 1 つを、plugins の i 番目のフックに渡す。失敗したときは、頼まれたことを捨てる。
    pub fn added(&mut self, i: usize, file: &TargetFile) -> Result<Ran, String> {
        let (out, ran) = self.call_targets(
            i,
            std::slice::from_ref(file),
            Context::Hook,
            HOOK_LIMIT,
            |p, s, mut ts| {
                p.call_added(
                    s,
                    Resource::new_borrow(0),
                    Resource::new_borrow(0),
                    &ts.remove(0),
                )
            },
        )?;
        out?;
        Ok(ran)
    }

    pub fn decode(&mut self, ext: &str, path: &Path) -> Result<Vec<u8>, String> {
        self.call(
            ext,
            Part::View,
            By::Sandbox,
            path,
            VIEW_LIMIT,
            |p, s, fmt, file| p.call_decode(s, fmt, &file),
        )
        .ok_or("詳細表示に対応するプラグインがありません")??
    }

    pub fn call_ui(
        &mut self,
        ext: &str,
        owner: UiOwner,
        path: &Path,
        target: Option<&str>,
        method: &str,
        args: &str,
    ) -> Result<String, String> {
        let (i, format) = match owner {
            UiOwner::Menu { plugin, note } => {
                let i = self.reg.index_of(plugin)?;
                if !self.reg.menu_covers(i, ext, note) {
                    return Err(format!(
                        "プラグイン「{plugin}」の右クリックメニューは、この素材に対応していません"
                    ));
                }
                (i, ext.to_owned())
            }
            UiOwner::Format(part) => {
                let (i, format) = self
                    .reg
                    .part(ext, part, By::Elevated)
                    .ok_or("elevated で対応するプラグインがありません")?;
                (i, format.to_owned())
            }
        };
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
        if !self.reg.plugins[i]
            .wasm
            .as_ref()
            .is_some_and(|w| w.has(Role::Call))
        {
            return Err(format!(
                "プラグイン「{}」の WASM は call を export していません",
                self.reg.plugins[i].manifest.id
            ));
        }
        // 読んだ設定はサムネイルを受け持つプラグインのものとして残すので、依存先が読んだものは残さない
        let reads = target.and_then(|_| self.store.data_mut().reads.take());
        let r = self.run(i, &format, ext, path, CALL_LIMIT, |p, s, fmt, file| {
            p.call_call(s, fmt, &file, method, args)
        });
        if reads.is_some() {
            self.store.data_mut().reads = reads;
        }
        r?
    }
}
