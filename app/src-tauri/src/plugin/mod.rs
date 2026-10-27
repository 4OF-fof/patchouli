//! プラグイン。形式（拡張子）ごとに、サムネイルの生成と、素材の詳細に出すものを受け持つ。受け持ち方は 2 層ある。
//!
//! - 宣言型: 処理は WASM のコンポーネント（`app/plugins/sdk/wit/plugin.wit`）で動かす。表示や設定は記述を返し、本体の部品が描く
//! - 組み込み UI: `plugin.json` の `ui` の ES モジュールを、隔離せずに本体の画面で動かす（`src/plugins/ui.ts`）
//! - 形式はほかの形式を引き継いで（extends）、一部（parts）だけを自分で受け持てる
//! - 同じ形式を 2 つのプラグインが受け持つときは、先に読んだほうを使い、両方にエラーを付ける
//! - 外のプラグインの本体はアプリのデータフォルダに置き、ライブラリに記録したものだけを使う。
//!   設定の値と、プラグインが自分で読み書きする値も、ライブラリに置く（record.rs）
//! - 手元のコマンドとほかのプラグインを、必須（required）か、あれば使う（optional）として求められる

mod builtin;
pub mod commands;
pub mod files;
pub mod install;
mod os;
pub mod record;
mod runtime;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use record::{Record, Source, Stored};
pub use runtime::{Runner, ViewOut, read};

/// 求めるもの。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Deps {
    /// 手元のコマンド（名前 → 版の下限など）。PATH から探す。
    #[serde(default)]
    pub commands: BTreeMap<String, commands::CommandDep>,
    /// ほかのプラグイン（id → 版の下限）。
    #[serde(default)]
    pub plugins: BTreeMap<String, PluginDep>,
}

/// 求めるプラグイン 1 つ。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginDep {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<String>,
}

/// サムネイルを作るときにプラグインが読んだ設定（key → 値）。値が変わったら作り直す。
pub type Reads = BTreeMap<String, Value>;

/// 形式ごとに受け持つもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    Thumbnail,
    View,
    /// 音の波形。組み込み UI だけが作れる。
    Waveform,
    /// カーソルを合わせたときに、サムネイルの上に重ねる表示。組み込み UI だけが描ける。
    Hover,
    /// この版のアプリが知らないもの。読み飛ばす。
    #[serde(other)]
    Unknown,
}

/// カーソルを合わせたときに、本体がサムネイルの上で見せるもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hover {
    /// 元のファイルを、音を消して動画として再生する。
    Video,
    /// この版のアプリが知らないもの。書いていないものとして扱う。
    #[serde(other)]
    Unknown,
}

/// サムネイルを決まった形の枠に入れるときの収め方。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    /// 真ん中を残して切り抜く。
    Center,
    /// 上の端を残して切り抜く。
    Top,
    /// 切り抜かずに収め、空いたところは地の色にする。
    Contain,
    /// この版のアプリが知らないもの。書いていないものとして扱う。
    #[serde(other)]
    Unknown,
}

/// 受け持ち方。wasm は宣言型、ui は組み込み UI。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum By {
    Wasm,
    Ui,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatDecl {
    /// 引き継ぐ形式。自分で受け持たないものと、書いていない呼び名などはそちらのものを使う。
    pub extends: Option<String>,
    pub label: Option<String>,
    /// 縦横比（幅 / 高さ）の既定。サムネイルができるまで使う。
    pub ratio: Option<f64>,
    /// サムネイルの枠への収め方。書かなければ真ん中を切り抜く。
    pub fit: Option<Fit>,
    /// カーソルを合わせたときに、本体が見せるもの。組み込み UI の hover があれば、そちらを使う。
    pub hover: Option<Hover>,
    /// WASM で受け持つもの。
    #[serde(default)]
    pub parts: Vec<Part>,
    /// 組み込み UI で受け持つもの。
    #[serde(default)]
    pub ui: Vec<Part>,
    /// 詳細に出すために WASM が PNG にしたもの（decode）を、取っておけるようにする。
    /// 取っておくかは、本体がこのプラグインの設定に足す項目で選ぶ（既定は取っておかない）。
    #[serde(default)]
    pub keep_decoded: bool,
}

/// 形式 format の、詳細用の画像を取っておくかの設定の key。
pub fn keep_decoded_key(format: &str) -> String {
    format!("@keepDecoded:{format}")
}

/// keepDecoded を書いた形式ごとに、本体が足す設定の項目。
fn keep_decoded_settings(m: &Manifest) -> impl Iterator<Item = SettingDecl> + '_ {
    m.formats
        .iter()
        .filter(|(_, d)| d.keep_decoded)
        .map(|(f, _)| SettingDecl {
            key: keep_decoded_key(f),
            label: format!("「.{f}」の詳細表示用の画像を保存"),
            help: Some("変換した画像をキャッシュに保存し、次回から速く表示します".into()),
            kind: SettingKind::Toggle,
            default: Value::Bool(false),
        })
}

/// 波形を作る時間の上限（秒）の設定の key。0 は上限なし。
pub const WAVEFORM_LIMIT_KEY: &str = "@waveformLimit";

/// 組み込み UI で波形を作るプラグインに、本体が足す設定の項目。
fn waveform_settings(m: &Manifest) -> Option<SettingDecl> {
    m.formats
        .values()
        .any(|d| d.ui.contains(&Part::Waveform))
        .then(|| SettingDecl {
            key: WAVEFORM_LIMIT_KEY.into(),
            label: "波形の作成時間の上限（秒）".into(),
            help: Some("0 にすると、上限なしで最後まで作成します".into()),
            kind: SettingKind::Number {
                min: Some(0.0),
                max: None,
                step: Some(1.0),
            },
            default: Value::from(60),
        })
}

/// `plugin.json`。処理の部分は同じフォルダの `plugin.wasm`。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// ないと動かないもの。
    #[serde(default)]
    pub required: Deps,
    /// あれば使うもの。
    #[serde(default)]
    pub optional: Deps,
    /// 組み込み UI の ES モジュール（plugin.json からの相対パス）。組み込みのプラグインでは ui/ の中に置く。
    pub ui: Option<String>,
    pub formats: BTreeMap<String, FormatDecl>,
}

pub const MANIFEST: &str = "plugin.json";
pub const WASM: &str = "plugin.wasm";

impl Manifest {
    pub fn read(dir: &Path) -> Result<Manifest, String> {
        let p = dir.join(MANIFEST);
        let text = fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
    }

    /// required か optional に書いたコマンド。書いていなければ None。
    pub fn declares(&self, command: &str) -> Option<&commands::CommandDep> {
        self.required
            .commands
            .get(command)
            .or_else(|| self.optional.commands.get(command))
    }

    fn wants_wasm(&self) -> bool {
        self.formats.values().any(|d| !d.parts.is_empty())
    }

    fn wants_ui(&self) -> bool {
        self.formats.values().any(|d| !d.ui.is_empty())
    }

    /// 受け持つもの（形式をまたいでまとめる）。
    fn caps(&self) -> Vec<Cap> {
        let mut out: Vec<Cap> = self
            .formats
            .values()
            .flat_map(|d| {
                let wasm = d.parts.iter().map(|&part| Cap { part, by: By::Wasm });
                wasm.chain(d.ui.iter().map(|&part| Cap { part, by: By::Ui }))
            })
            .filter(|c| c.part != Part::Unknown)
            .collect();
        out.sort();
        out.dedup();
        out
    }
}

/// プラグインのフォルダの中を指す、相対のパスか。
fn inside(rel: &str) -> bool {
    !rel.is_empty()
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
pub struct Problem {
    pub level: Level,
    pub text: String,
}

fn error(text: String) -> Problem {
    Problem {
        level: Level::Error,
        text,
    }
}

/// 設定の項目の種類。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SettingKind {
    Toggle,
    Number {
        min: Option<f64>,
        max: Option<f64>,
        step: Option<f64>,
    },
    Text,
    Choice {
        choices: Vec<Choice>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct Choice {
    pub value: String,
    pub label: String,
}

/// プラグインが返した設定の項目。
#[derive(Debug, Clone, Serialize)]
pub struct SettingDecl {
    pub key: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    #[serde(flatten)]
    pub kind: SettingKind,
    pub default: Value,
}

impl SettingDecl {
    /// 種類に合う値にする。合わなければ None。
    fn accept(&self, v: &Value) -> Option<Value> {
        match (&self.kind, v) {
            (SettingKind::Toggle, Value::Bool(_)) => Some(v.clone()),
            (SettingKind::Number { min, max, .. }, Value::Number(n)) => {
                let mut x = n.as_f64()?;
                if let Some(m) = min {
                    x = x.max(*m);
                }
                if let Some(m) = max {
                    x = x.min(*m);
                }
                serde_json::Number::from_f64(x).map(Value::Number)
            }
            (SettingKind::Text, Value::String(_)) => Some(v.clone()),
            (SettingKind::Choice { choices }, Value::String(s)) => {
                choices.iter().any(|c| &c.value == s).then(|| v.clone())
            }
            _ => None,
        }
    }
}

/// 画面に渡す設定の項目。value はいまの値。
#[derive(Debug, Clone, Serialize)]
pub struct SettingStatus {
    #[serde(flatten)]
    pub decl: SettingDecl,
    pub value: Value,
}

struct Loaded {
    manifest: Manifest,
    builtin: bool,
    /// 外のプラグインのフォルダ。
    dir: Option<PathBuf>,
    wasm: Option<Arc<runtime::Prepared>>,
    /// 組み込み UI の ES モジュール。フォルダの中にあると確かめたもの。
    ui: Option<String>,
    settings: Vec<SettingDecl>,
    problems: Vec<Problem>,
    source: Option<Source>,
    /// ライブラリに記録した版。
    recorded: Option<String>,
    /// 必須の依存が足りないので、何も受け持たせない（読み込まないのと同じ）。
    blocked: bool,
}

/// プラグイン id（いまの版は version）が dep を満たしているか。使っていなければ version は None。
fn plugin_met(version: Option<&str>, dep: &PluginDep) -> bool {
    version.is_some_and(|v| !dep.min.as_deref().is_some_and(|m| commands::older(v, m)))
}

/// 必須の依存が足りないものを止める。止めたものを必須にしているものも止める。
fn block_unmet(plugins: &mut [Loaded]) {
    loop {
        let active: HashMap<String, String> = plugins
            .iter()
            .filter(|p| !p.blocked)
            .map(|p| (p.manifest.id.clone(), p.manifest.version.clone()))
            .collect();
        let mut changed = false;
        for p in plugins.iter_mut().filter(|p| !p.blocked) {
            let r = &p.manifest.required;
            if r.commands
                .iter()
                .any(|(c, d)| !commands::valid(c) || commands::check(c, d).is_err())
                || r.plugins
                    .iter()
                    .any(|(id, d)| !plugin_met(active.get(id).map(String::as_str), d))
            {
                p.blocked = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
}

/// 引き継ぎをたどったあとの形式。
#[derive(Debug, Clone)]
struct Resolved {
    owner: usize,
    label: String,
    ratio: f64,
    fit: Fit,
    hover: Option<Hover>,
    parts: HashMap<Part, Handler>,
}

/// 受け持つプラグインと、その中での形式、受け持ち方。
#[derive(Debug, Clone)]
struct Handler {
    plugin: usize,
    format: String,
    by: By,
}

/// 組み込み UI の場所。module はプラグインのフォルダの中のパス。
#[derive(Debug, Clone, Serialize)]
pub struct UiRef {
    pub plugin: String,
    pub module: String,
}

/// 受け持つもの 1 つ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Cap {
    pub part: Part,
    pub by: By,
}

/// 画面に渡す形式。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub ext: String,
    pub label: String,
    pub ratio: f64,
    pub fit: Fit,
    /// 受け持つプラグインの id。
    pub plugin: String,
    pub thumbnail: bool,
    /// サムネイルを組み込み UI が作るときの、その UI。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_thumbnail: Option<UiRef>,
    /// 波形を作る組み込み UI。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_waveform: Option<UiRef>,
    /// カーソルを合わせたときに、本体が見せるもの。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover: Option<Hover>,
    /// カーソルを合わせたときの表示を描く組み込み UI。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_hover: Option<UiRef>,
}

/// active 使っている / missing ライブラリに記録してあるがアプリに入っていない /
/// blocked 必須の依存が足りないので読み込んでいない
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Active,
    Missing,
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    pub id: String,
    pub name: String,
    /// アプリに入っている版。入っていなければない。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// ライブラリに記録した版。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    pub description: String,
    pub builtin: bool,
    pub state: State,
    pub required: Deps,
    pub optional: Deps,
    /// 依存先を通して動かせるコマンド。
    pub via: Vec<Via>,
    /// 受け持つもの。
    pub caps: Vec<Cap>,
    /// 受け持っている形式。
    pub formats: Vec<String>,
    pub settings: Vec<SettingStatus>,
    pub problems: Vec<Problem>,
}

/// 使っているプラグインが求めるコマンド。
#[derive(Debug, Clone, Serialize)]
pub struct CommandStatus {
    pub name: String,
    /// 見つけた場所。見つからなければない。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    /// 見つけたものの版。版の取り方を書いたプラグインがなければない。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// 依存先のプラグインを通して動かせるコマンド。required は、その依存先が必須か。
#[derive(Debug, Clone, Serialize)]
pub struct Via {
    pub name: String,
    /// 依存先のプラグインの名前。
    pub plugin: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReport {
    pub plugins: Vec<PluginStatus>,
    /// 名前順。
    pub commands: Vec<CommandStatus>,
}

pub struct Registry {
    plugins: Vec<Loaded>,
    formats: HashMap<String, Resolved>,
    /// 記録してあるのに入っていないもの。
    others: Vec<PluginStatus>,
    /// ライブラリの記録。
    record: Record,
    /// プラグインごとの設定の値と、プラグインが読み書きする値（id → 値）。変えるとライブラリに書く。
    stored: RwLock<HashMap<String, Stored>>,
    /// 開いているライブラリ。組み込みだけのときはない。
    root: Option<PathBuf>,
}

const DEFAULT_RATIO: f64 = 1.6;

/// 組み込みのプラグインの id。外のプラグインには使えない。
pub fn builtin_ids() -> Vec<String> {
    builtin::ids()
}

impl Registry {
    /// 組み込みのプラグインだけ。ライブラリを開く前に使う。
    pub fn builtin() -> Registry {
        let mut r = Registry {
            plugins: builtin::load(),
            formats: HashMap::new(),
            others: Vec::new(),
            record: Record::default(),
            stored: RwLock::new(HashMap::new()),
            root: None,
        };
        r.resolve();
        r
    }

    /// 組み込みのプラグインと、ライブラリ root に記録してあるプラグイン（本体は dir の下）を読む。
    /// 記録を読めなかったときは、組み込みのものだけにして、その理由を返す。
    pub fn open(root: &Path, dir: &Path) -> (Registry, Vec<String>) {
        let mut problems = Vec::new();
        let record = Record::read(&record::path(root)).unwrap_or_else(|e| {
            problems.push(e);
            Record::default()
        });
        let mut plugins = builtin::load();
        let mut others = Vec::new();
        let builtin_ids: HashSet<String> = plugins.iter().map(|p| p.manifest.id.clone()).collect();
        for (id, entry) in &record.plugins {
            if builtin_ids.contains(id) {
                continue;
            }
            let at = dir.join(id);
            match Manifest::read(&at) {
                Ok(manifest) => plugins.push(load_external(manifest, at, entry)),
                Err(_) => others.push(PluginStatus {
                    id: id.clone(),
                    name: id.clone(),
                    version: None,
                    recorded: entry.version.clone(),
                    source: entry.source.clone(),
                    description: String::new(),
                    builtin: false,
                    state: State::Missing,
                    required: Deps::default(),
                    optional: Deps::default(),
                    via: Vec::new(),
                    caps: Vec::new(),
                    formats: Vec::new(),
                    settings: Vec::new(),
                    problems: vec![error("この端末にインストールされていません".into())],
                }),
            }
        }
        block_unmet(&mut plugins);
        let stored = plugins
            .iter()
            .map(|p| {
                let id = p.manifest.id.clone();
                let s = Stored::read(&record::stored_path(root, &id)).unwrap_or_else(|e| {
                    problems.push(e);
                    Stored::default()
                });
                (id, s)
            })
            .collect();
        let mut r = Registry {
            plugins,
            formats: HashMap::new(),
            others,
            record,
            stored: RwLock::new(stored),
            root: Some(root.to_owned()),
        };
        r.resolve();
        (r, problems)
    }

    fn resolve(&mut self) {
        // 形式ごとに、受け持つプラグインを決める
        let mut claim: HashMap<String, usize> = HashMap::new();
        let mut conflicts = Vec::new();
        for (i, p) in self.plugins.iter().enumerate().filter(|(_, p)| !p.blocked) {
            for ext in p.manifest.formats.keys() {
                match claim.get(ext) {
                    Some(&first) => conflicts.push((first, i, ext.clone())),
                    None => {
                        claim.insert(ext.clone(), i);
                    }
                }
            }
        }
        for (first, second, ext) in conflicts {
            let (a, b) = (self.name(first).to_owned(), self.name(second).to_owned());
            self.plugins[first].problems.push(error(format!(
                "「.{ext}」は「{b}」とも重複しています。このプラグインが優先されます"
            )));
            self.plugins[second].problems.push(error(format!(
                "「.{ext}」はすでに「{a}」が対応しているため、無効になっています"
            )));
        }

        let mut formats = HashMap::new();
        let mut problems: Vec<(usize, Problem)> = Vec::new();
        for (ext, &owner) in &claim {
            let mut label = None;
            let mut ratio = None;
            let mut fit = None;
            let mut hover = None;
            let mut parts = HashMap::new();
            let mut seen = HashSet::new();
            let (mut at, mut fmt) = (owner, ext.clone());
            loop {
                if !seen.insert(fmt.clone()) {
                    problems.push((
                        owner,
                        error(format!("「.{ext}」の形式定義（extends）が循環しています")),
                    ));
                    break;
                }
                let decl = &self.plugins[at].manifest.formats[&fmt];
                label = label.or_else(|| decl.label.clone());
                ratio = ratio.or(decl.ratio);
                fit = fit.or(decl.fit.filter(|&f| f != Fit::Unknown));
                hover = hover.or(decl.hover.filter(|&h| h != Hover::Unknown));
                let own = decl.parts.iter().map(|&p| (p, By::Wasm));
                for (part, by) in own.chain(decl.ui.iter().map(|&p| (p, By::Ui))) {
                    if part != Part::Unknown {
                        parts.entry(part).or_insert_with(|| Handler {
                            plugin: at,
                            format: fmt.clone(),
                            by,
                        });
                    }
                }
                let Some(base) = &decl.extends else { break };
                let Some(&next) = claim.get(base) else {
                    problems.push((
                        at,
                        error(format!(
                            "「.{fmt}」が引き継ぐ「.{base}」に対応するプラグインがありません"
                        )),
                    ));
                    break;
                };
                (at, fmt) = (next, base.clone());
            }
            // 処理の部分や組み込み UI がなければ、受け持てない
            parts.retain(|_, h| match h.by {
                By::Wasm => self.plugins[h.plugin].wasm.is_some(),
                By::Ui => self.plugins[h.plugin].ui.is_some(),
            });
            formats.insert(
                ext.clone(),
                Resolved {
                    owner,
                    label: label.unwrap_or_else(|| ext.to_uppercase()),
                    ratio: ratio.unwrap_or(DEFAULT_RATIO),
                    fit: fit.unwrap_or(Fit::Center),
                    hover,
                    parts,
                },
            );
        }
        for (i, p) in self.plugins.iter_mut().enumerate() {
            if p.manifest.wants_wasm() && p.wasm.is_none() && p.problems.is_empty() {
                p.problems.push(error(
                    "plugin.wasm が見つからないため、サムネイルと詳細表示を処理できません".into(),
                ));
            }
            if p.manifest.wants_ui() && p.ui.is_none() && p.problems.is_empty() {
                p.problems.push(error(
                    "UI ファイル（plugin.json の ui）が見つからないため、UI を表示できません"
                        .into(),
                ));
            }
            p.problems.extend(
                problems
                    .iter()
                    .filter(|(at, _)| *at == i)
                    .map(|(_, x)| x.clone()),
            );
        }
        self.formats = formats;
    }

    fn name(&self, i: usize) -> &str {
        &self.plugins[i].manifest.name
    }

    /// この拡張子（小文字）のファイルを扱えるか。
    pub fn knows(&self, ext: &str) -> bool {
        self.formats.contains_key(ext)
    }

    /// 拡張子（大文字小文字を問わない）からファイルを扱えるか。
    pub fn knows_path(&self, p: &Path) -> bool {
        p.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| self.knows(&e.to_lowercase()))
    }

    /// part をどう受け持つか。受け持つものがなければ None。
    pub fn handles(&self, ext: &str, part: Part) -> Option<By> {
        Some(self.formats.get(ext)?.parts.get(&part)?.by)
    }

    /// part を by で受け持つプラグインと、その中での形式。
    fn part(&self, ext: &str, part: Part, by: By) -> Option<(usize, &str)> {
        let h = self.formats.get(ext)?.parts.get(&part)?;
        (h.by == by).then_some((h.plugin, h.format.as_str()))
    }

    /// ext の縦横比（幅 / 高さ）の既定。
    pub fn ratio_of(&self, ext: &str) -> f64 {
        self.formats.get(ext).map_or(DEFAULT_RATIO, |f| f.ratio)
    }

    /// ext のサムネイルを受け持つプラグインの位置。
    fn thumb_plugin(&self, ext: &str) -> Option<usize> {
        let by = self.handles(ext, Part::Thumbnail)?;
        Some(self.part(ext, Part::Thumbnail, by)?.0)
    }

    /// ext のサムネイルを受け持つプラグインの id。
    pub fn thumb_owner(&self, ext: &str) -> Option<&str> {
        Some(&self.plugins[self.thumb_plugin(ext)?].manifest.id)
    }

    /// ext のサムネイルを受け持つプラグインの、設定 key のいまの値。読めなければ Null。
    pub fn thumb_setting(&self, ext: &str, key: &str) -> Value {
        self.thumb_plugin(ext)
            .and_then(|i| self.setting(i, key))
            .unwrap_or(Value::Null)
    }

    /// ext の詳細用の画像を取っておくなら、decode するプラグインの id と形式。
    pub fn keeps_decoded(&self, ext: &str) -> Option<(&str, &str)> {
        let (i, format) = self.part(ext, Part::View, By::Wasm)?;
        let on = self.setting(i, &keep_decoded_key(format)) == Some(Value::Bool(true));
        on.then(|| (self.plugins[i].manifest.id.as_str(), format))
    }

    /// part を受け持つ組み込み UI。
    pub fn ui_of(&self, ext: &str, part: Part) -> Option<UiRef> {
        let (i, _) = self.part(ext, part, By::Ui)?;
        let p = &self.plugins[i];
        Some(UiRef {
            plugin: p.manifest.id.clone(),
            module: p.ui.clone()?,
        })
    }

    /// 入っている外のプラグインか。
    pub fn installed(&self, id: &str) -> bool {
        self.plugins
            .iter()
            .any(|p| p.manifest.id == id && p.dir.is_some())
    }

    /// 使っているプラグイン id の、plugin.json からのパスが rel のファイル。
    pub fn file(&self, id: &str, rel: &str) -> Option<Vec<u8>> {
        let p = self.plugins.iter().find(|p| p.manifest.id == id)?;
        match &p.dir {
            Some(dir) => files::read(dir, rel),
            None if p.builtin => builtin::file(id, rel).map(<[u8]>::to_vec),
            None => None,
        }
    }

    /// 記録してある取得先と、取得元の検証値。
    pub fn source_of(&self, id: &str) -> Option<(Source, Option<String>)> {
        let e = self.record.plugins.get(id)?;
        Some((e.source.clone()?, e.hash.clone()))
    }

    /// i 番目のプラグインの設定 key のいまの値。変えていなければ既定の値。
    fn setting(&self, i: usize, key: &str) -> Option<Value> {
        let p = &self.plugins[i];
        let decl = p.settings.iter().find(|s| s.key == key)?;
        let stored = self
            .stored
            .read()
            .ok()?
            .get(&p.manifest.id)
            .and_then(|s| s.settings.get(key))
            .and_then(|v| decl.accept(v));
        Some(stored.unwrap_or_else(|| decl.default.clone()))
    }

    /// i 番目のプラグインの残す値を f で変えて、ライブラリに書く。
    fn store(&self, i: usize, f: impl FnOnce(&mut Stored)) -> Result<(), String> {
        let root = self.root.as_ref().ok_or("ライブラリが開かれていません")?;
        let id = &self.plugins[i].manifest.id;
        let mut all = self.stored.write().map_err(|e| e.to_string())?;
        let s = all.entry(id.clone()).or_default();
        f(s);
        s.write(&record::stored_path(root, id))
    }

    /// i 番目のプラグインが自分で残した値。
    fn data(&self, i: usize, key: &str) -> Option<String> {
        let all = self.stored.read().ok()?;
        let v = all.get(&self.plugins[i].manifest.id)?.data.get(key)?;
        v.as_str().map(str::to_owned)
    }

    /// i 番目のプラグインが値を残す。None なら消す。
    fn set_data(&self, i: usize, key: &str, value: Option<String>) -> Result<(), String> {
        self.store(i, |s| match value {
            Some(v) => {
                s.data.insert(key.to_owned(), Value::String(v));
            }
            None => {
                s.data.remove(key);
            }
        })
    }

    /// 使っているプラグインの、設定のいまの値すべて。
    pub fn settings_of(&self, id: &str) -> Option<serde_json::Map<String, Value>> {
        let i = self.plugins.iter().position(|p| p.manifest.id == id)?;
        Some(
            self.plugins[i]
                .settings
                .iter()
                .filter_map(|d| Some((d.key.clone(), self.setting(i, &d.key)?)))
                .collect(),
        )
    }

    fn index_of(&self, id: &str) -> Result<usize, String> {
        self.plugins
            .iter()
            .position(|p| p.manifest.id == id)
            .ok_or_else(|| format!("プラグイン「{id}」は有効ではありません"))
    }

    /// 使っているプラグインが自分で残した値。
    pub fn data_of(&self, id: &str, key: &str) -> Result<Option<String>, String> {
        Ok(self.data(self.index_of(id)?, key))
    }

    /// 使っているプラグインが値を残す。None なら消す。
    pub fn set_data_of(&self, id: &str, key: &str, value: Option<String>) -> Result<(), String> {
        self.set_data(self.index_of(id)?, key, value)
    }

    /// 設定を変えて、ライブラリに書く。
    pub fn set_setting(&self, id: &str, key: &str, value: &Value) -> Result<(), String> {
        let i = self.index_of(id)?;
        let decl = self.plugins[i]
            .settings
            .iter()
            .find(|s| s.key == key)
            .ok_or_else(|| format!("設定項目「{key}」が見つかりません"))?;
        let v = decl
            .accept(value)
            .ok_or_else(|| format!("「{key}」の設定値が無効です：{value}"))?;
        self.store(i, |s| {
            s.settings.insert(key.to_owned(), v);
        })
    }

    pub fn formats(&self) -> Vec<FormatInfo> {
        let id = |i: usize| self.plugins[i].manifest.id.clone();
        let mut out: Vec<FormatInfo> = self
            .formats
            .iter()
            .map(|(ext, f)| FormatInfo {
                ext: ext.clone(),
                label: f.label.clone(),
                ratio: f.ratio,
                fit: f.fit,
                plugin: id(f.owner),
                thumbnail: f.parts.contains_key(&Part::Thumbnail),
                ui_thumbnail: self.ui_of(ext, Part::Thumbnail),
                ui_waveform: self.ui_of(ext, Part::Waveform),
                hover: f.hover,
                ui_hover: self.ui_of(ext, Part::Hover),
            })
            .collect();
        out.sort_by(|a, b| a.ext.cmp(&b.ext));
        out
    }

    /// i 番目のプラグインの組み込み UI から呼べる、依存先のプラグインの位置と、その依存先が必須か。
    /// 使っていて版の下限を満たすものだけ。
    fn reachable(&self, i: usize) -> Vec<(usize, bool)> {
        let m = &self.plugins[i].manifest;
        [(&m.required, true), (&m.optional, false)]
            .into_iter()
            .flat_map(|(deps, required)| deps.plugins.iter().map(move |d| (d, required)))
            .filter_map(|((id, d), required)| {
                let q = self
                    .plugins
                    .iter()
                    .position(|q| q.manifest.id == *id && !q.blocked)?;
                plugin_met(Some(&self.plugins[q].manifest.version), d).then_some((q, required))
            })
            .collect()
    }

    pub fn report(&self) -> PluginReport {
        // コマンドごとに、どれかのプラグインが書いた版の取り方で版も調べる
        let mut probes: BTreeMap<&String, Option<&commands::Probe>> = BTreeMap::new();
        for p in &self.plugins {
            let m = &p.manifest;
            for (c, d) in m.required.commands.iter().chain(&m.optional.commands) {
                if commands::valid(c) {
                    let e = probes.entry(c).or_default();
                    *e = e.or(d.version.as_ref());
                }
            }
        }
        let commands: Vec<CommandStatus> = probes
            .into_iter()
            .map(|(name, probe)| {
                let path = commands::find(name);
                let version = path
                    .as_deref()
                    .zip(probe)
                    .and_then(|(p, probe)| commands::version_of(p, probe).ok());
                CommandStatus {
                    name: name.clone(),
                    path,
                    version,
                }
            })
            .collect();
        let active = |id: &str| {
            self.plugins
                .iter()
                .find(|p| p.manifest.id == id && !p.blocked)
        };
        let mut plugins: Vec<PluginStatus> = self
            .plugins
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let m = &p.manifest;
                let mut problems = p.problems.clone();
                for (deps, required) in [(&m.required, true), (&m.optional, false)] {
                    let level = if required { Level::Error } else { Level::Warning };
                    let limits = if required {
                        "利用できません"
                    } else {
                        "一部の機能を利用できません"
                    };
                    for (c, d) in &deps.commands {
                        let min = d.min.as_deref().unwrap_or_default();
                        let text = if !commands::valid(c) {
                            format!("外部ツール名「{c}」の形式が正しくありません")
                        } else {
                            match commands::check(c, d) {
                                Ok(_) => continue,
                                Err(commands::Unmet::Missing) if required => {
                                    format!("必須の外部ツール「{c}」が見つかりません")
                                }
                                Err(commands::Unmet::Missing) => format!(
                                    "外部ツール「{c}」が見つからないため、一部の機能を利用できません"
                                ),
                                Err(commands::Unmet::Old(v)) => format!(
                                    "外部ツール「{c}」のバージョン（{v}）が古いため、{limits}（{min} 以上が必要です）"
                                ),
                                Err(commands::Unmet::Unknown(e)) => {
                                    format!("外部ツール「{c}」のバージョンを確認できません：{e}")
                                }
                            }
                        };
                        problems.push(Problem {
                            level: level.clone(),
                            text,
                        });
                    }
                    for (id, d) in &deps.plugins {
                        let now = active(id).map(|q| q.manifest.version.as_str());
                        if plugin_met(now, d) {
                            continue;
                        }
                        let min = d.min.as_deref().unwrap_or_default();
                        let text = match now {
                            Some(v) => format!(
                                "プラグイン「{id}」のバージョン（{v}）が古いため、{limits}（{min} 以上が必要です）"
                            ),
                            None if required => format!("必須プラグイン「{id}」が有効ではありません"),
                            None => format!(
                                "プラグイン「{id}」が有効でないため、一部の機能を利用できません"
                            ),
                        };
                        problems.push(Problem {
                            level: level.clone(),
                            text,
                        });
                    }
                }
                // 組み込み UI は依存先の関数を呼べるので、依存先が動かせるコマンドも見せる
                let via = if m.wants_ui() {
                    self.reachable(i)
                        .into_iter()
                        .flat_map(|(q, required)| {
                            let qm = &self.plugins[q].manifest;
                            qm.required
                                .commands
                                .keys()
                                .chain(qm.optional.commands.keys())
                                .map(move |c| Via {
                                    name: c.clone(),
                                    plugin: qm.name.clone(),
                                    required,
                                })
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                if let Some(r) = p.recorded.as_ref().filter(|r| **r != m.version) {
                    problems.push(Problem {
                        level: Level::Warning,
                        text: format!(
                            "インストール済みのバージョン（{}）がライブラリの記録（{r}）と異なります",
                            m.version
                        ),
                    });
                }
                let mut formats: Vec<String> = self
                    .formats
                    .iter()
                    .filter(|(_, f)| f.owner == i)
                    .map(|(e, _)| e.clone())
                    .collect();
                formats.sort();
                let settings = p
                    .settings
                    .iter()
                    .map(|d| SettingStatus {
                        decl: d.clone(),
                        value: self.setting(i, &d.key).unwrap_or(Value::Null),
                    })
                    .collect();
                PluginStatus {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    version: Some(m.version.clone()),
                    recorded: p.recorded.clone(),
                    source: p.source.clone(),
                    description: m.description.clone(),
                    builtin: p.builtin,
                    state: if p.blocked {
                        State::Blocked
                    } else {
                        State::Active
                    },
                    required: m.required.clone(),
                    optional: m.optional.clone(),
                    via,
                    caps: m.caps(),
                    formats,
                    settings,
                    problems,
                }
            })
            .collect();
        plugins.extend(self.others.iter().cloned());
        PluginReport { plugins, commands }
    }
}

/// 外のプラグインを読み、処理の部分を動かせるようにして、設定の項目を聞いておく。
fn load_external(manifest: Manifest, dir: PathBuf, entry: &record::Entry) -> Loaded {
    let mut problems = Vec::new();
    let wasm_path = dir.join(WASM);
    let wasm = if wasm_path.is_file() {
        match fs::read(&wasm_path)
            .map_err(|e| e.to_string())
            .and_then(|b| runtime::Prepared::new(&b))
        {
            Ok(p) => Some(Arc::new(p)),
            Err(e) => {
                problems.push(error(format!("plugin.wasm の読み込みに失敗しました：{e}")));
                None
            }
        }
    } else {
        None
    };
    let ui = manifest.ui.clone().filter(|m| {
        let ok = inside(m) && dir.join(m).is_file();
        if !ok {
            problems.push(error(format!("UI ファイル（{m}）が見つかりません")));
        }
        ok
    });
    let settings = settings_of(wasm.as_deref(), &manifest, &mut problems);
    Loaded {
        manifest,
        builtin: false,
        dir: Some(dir),
        wasm,
        ui,
        settings,
        problems,
        source: entry.source.clone(),
        recorded: entry.version.clone(),
        blocked: false,
    }
}

/// WASM が返す設定の項目と、本体が足すもの。
fn settings_of(
    wasm: Option<&runtime::Prepared>,
    m: &Manifest,
    problems: &mut Vec<Problem>,
) -> Vec<SettingDecl> {
    let mut list = match wasm.map(|w| w.settings(&m.id)) {
        None => Vec::new(),
        Some(Ok(s)) => s,
        Some(Err(e)) => {
            problems.push(error(format!("設定項目の読み込みに失敗しました：{e}")));
            Vec::new()
        }
    };
    list.extend(keep_decoded_settings(m));
    list.extend(waveform_settings(m));
    list
}
