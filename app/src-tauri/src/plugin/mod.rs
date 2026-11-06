mod builtin;
pub mod commands;
pub mod files;
pub mod github;
pub(crate) mod hooks;
pub mod install;
pub(crate) mod ipc;
pub mod record;
mod runtime;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use record::{Record, Source, Stored};
pub use runtime::{
    Action, ContentBudget, ContentMedia, ContentPart, Env, ItemInfo, MenuRun, MenuShown, Ran,
    Runner, TargetFile, UiOwner, ViewOut, read, set_compiled_dir,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Deps {
    #[serde(default)]
    pub commands: BTreeMap<String, commands::CommandDep>,
    #[serde(default)]
    pub plugins: BTreeMap<String, PluginDep>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginDep {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<String>,
}

pub type Reads = BTreeMap<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    Thumbnail,
    View,
    Waveform,
    Hover,
    Details,
    Embed,
    Menu,
    Content,
    Link,
    #[serde(other)]
    Unknown,
}

/// link を受け持つ形式で、ほかに受け持つものがなければ、URL ごとに links のプラグインか本体が受け持つもの。
const LINK_PARTS: [Part; 4] = [Part::Thumbnail, Part::View, Part::Embed, Part::Details];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hover {
    Video,
    Audio,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Embed {
    View,
    Card,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Center,
    Top,
    Contain,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum By {
    Sandbox,
    Elevated,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatDecl {
    pub extends: Option<String>,
    pub label: Option<String>,
    pub ratio: Option<f64>,
    pub fit: Option<Fit>,
    pub hover: Option<Hover>,
    pub embed: Option<Embed>,
    /// WASM の export にある役割を受け持たせる。
    #[serde(default)]
    pub sandbox: bool,
    #[serde(default)]
    pub elevated: Vec<Part>,
    #[serde(default)]
    pub keep_decoded: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LinkDecl {
    #[serde(default)]
    pub elevated: Vec<Part>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MenuEvery {
    /// ノートも含めたすべて。
    All,
    /// ノートを除いたすべてのファイル。
    Files,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum MenuFormats {
    List(Vec<String>),
    Every(MenuEvery),
}

#[derive(Debug, Clone, Deserialize)]
pub struct MenuDecl {
    pub formats: MenuFormats,
    pub by: By,
}

impl MenuDecl {
    fn covers(&self, ext: &str, note: bool) -> bool {
        match &self.formats {
            MenuFormats::List(l) => l.iter().any(|f| f.eq_ignore_ascii_case(ext)),
            MenuFormats::Every(MenuEvery::All) => true,
            MenuFormats::Every(MenuEvery::Files) => !note,
            MenuFormats::Every(MenuEvery::Unknown) => false,
        }
    }
}

/// 取り込みのフック。対象の書き方は menu と同じ。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct HooksDecl {
    pub added: Option<MenuDecl>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScreenDecl {
    pub label: String,
    pub icon: Option<String>,
    /// 場所のメニューに並べるか。並べないものは、右クリックメニューなどから開く。
    #[serde(default = "yes")]
    pub place: bool,
    #[serde(default)]
    pub window: WindowDecl,
}

fn yes() -> bool {
    true
}

/// 別のウィンドウで開いたときの大きさ（px）の既定。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowDecl {
    #[serde(default = "window_width")]
    pub width: f64,
    #[serde(default = "window_height")]
    pub height: f64,
}

impl Default for WindowDecl {
    fn default() -> WindowDecl {
        WindowDecl {
            width: window_width(),
            height: window_height(),
        }
    }
}

fn window_width() -> f64 {
    480.0
}

fn window_height() -> f64 {
    640.0
}

/// ホスト名をそろえる。大文字と末尾の点は区別しない。
pub fn host_key(h: &str) -> String {
    h.trim_end_matches('.').to_ascii_lowercase()
}

/// plugin.json の決まり。SDK の CLI も同じファイルを読んで確かめる。
pub struct Rules {
    id: regex::Regex,
    screen_id: regex::Regex,
    fetch_host: regex::Regex,
    /// permissions に書けるもの。WIT の interface の名前と同じ。
    pub permissions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RulesJson {
    id: String,
    screen_id: String,
    fetch_host: String,
    permissions: Vec<String>,
}

pub fn rules() -> &'static Rules {
    static R: std::sync::OnceLock<Rules> = std::sync::OnceLock::new();
    R.get_or_init(|| {
        let j: RulesJson = serde_json::from_str(include_str!("../../../plugins/sdk/rules.json"))
            .expect("SDK の rules.json が読めない");
        let re = |s: &str| regex::Regex::new(s).expect("SDK の rules.json の正規表現が正しくない");
        Rules {
            id: re(&j.id),
            screen_id: re(&j.screen_id),
            fetch_host: re(&j.fetch_host),
            permissions: j.permissions,
        }
    })
}

impl Rules {
    pub fn id_ok(&self, id: &str) -> bool {
        self.id.is_match(id)
    }

    pub fn permitted(&self, x: &str) -> bool {
        self.permissions.iter().any(|p| p == x)
    }
}

/// fetch に書けるホスト名か。「com」のようにトップレベルドメインだけのものは書けない。
pub fn fetch_host_ok(pattern: &str) -> bool {
    rules().fetch_host.is_match(&host_key(pattern))
}

/// pattern がホスト名 host か、その上のドメインか。
pub fn host_matches(pattern: &str, host: &str) -> bool {
    fetch_host_ok(pattern)
        && (host == pattern
            || host
                .strip_suffix(pattern)
                .is_some_and(|rest| rest.ends_with('.')))
}

pub fn keep_decoded_key(format: &str) -> String {
    format!("@keepDecoded:{format}")
}

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

pub const WAVEFORM_LIMIT_KEY: &str = "@waveformLimit";

fn waveform_settings(m: &Manifest) -> Option<SettingDecl> {
    m.formats
        .values()
        .any(|d| d.elevated.contains(&Part::Waveform))
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub required: Deps,
    #[serde(default)]
    pub optional: Deps,
    pub elevated: Option<String>,
    #[serde(default, deserialize_with = "lowercase_formats")]
    pub formats: BTreeMap<String, FormatDecl>,
    #[serde(default)]
    pub links: BTreeMap<String, LinkDecl>,
    #[serde(default)]
    pub screens: BTreeMap<String, ScreenDecl>,
    pub menu: Option<MenuDecl>,
    #[serde(default)]
    pub hooks: HooksDecl,
    /// WASM に渡すホストの interface。書いていないものを使う WASM は読み込まない。
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub fetch: Vec<String>,
}

/// 拡張子は小文字で探すので、formats のキーと extends は読むときに小文字にそろえる。
fn lowercase_formats<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<BTreeMap<String, FormatDecl>, D::Error> {
    Ok(BTreeMap::<String, FormatDecl>::deserialize(d)?
        .into_iter()
        .map(|(ext, mut f)| {
            f.extends = f.extends.map(|e| e.to_ascii_lowercase());
            (ext.to_ascii_lowercase(), f)
        })
        .collect())
}

pub const MANIFEST: &str = "plugin.json";
pub const WASM: &str = "plugin.wasm";

impl Manifest {
    pub fn read(dir: &Path) -> Result<Manifest, String> {
        let p = dir.join(MANIFEST);
        let text = fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
    }

    pub fn declares(&self, command: &str) -> Option<&commands::CommandDep> {
        self.required
            .commands
            .get(command)
            .or_else(|| self.optional.commands.get(command))
    }

    fn menu_by(&self, by: By) -> bool {
        self.menu.as_ref().is_some_and(|m| m.by == by)
    }

    fn wants_sandbox(&self) -> bool {
        self.formats.values().any(|d| d.sandbox)
            || self.menu_by(By::Sandbox)
            || self.hooks.added.is_some()
    }

    fn wants_elevated(&self) -> bool {
        self.formats.values().any(|d| !d.elevated.is_empty())
            || self.links.values().any(|d| !d.elevated.is_empty())
            || !self.screens.is_empty()
            || self.menu_by(By::Elevated)
    }

    /// sandbox の受け持つものは WASM の export で決まるので、wasm がなければ並べない。
    fn caps(&self, wasm: Option<&runtime::Prepared>) -> Vec<Cap> {
        let parts: Vec<Part> = wasm.map(|w| w.parts().collect()).unwrap_or_default();
        let mut out: Vec<Cap> = self
            .formats
            .values()
            .flat_map(|d| {
                let own = if d.sandbox { parts.as_slice() } else { &[] };
                let sandbox = own.iter().map(|&part| Cap {
                    part,
                    by: By::Sandbox,
                });
                sandbox.chain(d.elevated.iter().map(|&part| Cap {
                    part,
                    by: By::Elevated,
                }))
            })
            .chain(self.links.values().flat_map(|d| {
                d.elevated.iter().map(|&part| Cap {
                    part,
                    by: By::Elevated,
                })
            }))
            .chain(self.menu.as_ref().map(|m| Cap {
                part: Part::Menu,
                by: m.by,
            }))
            .filter(|c| c.part != Part::Unknown && c.by != By::Unknown)
            .collect();
        out.sort();
        out.dedup();
        out
    }
}

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

#[derive(Debug, Clone, Serialize)]
pub struct SettingStatus {
    #[serde(flatten)]
    pub decl: SettingDecl,
    pub value: Value,
}

struct Loaded {
    manifest: Manifest,
    builtin: bool,
    dir: Option<PathBuf>,
    wasm: Option<Arc<runtime::Prepared>>,
    elevated: Option<String>,
    settings: Vec<SettingDecl>,
    problems: Vec<Problem>,
    source: Option<Source>,
    recorded: Option<String>,
    blocked: bool,
    dev: bool,
}

fn plugin_met(version: Option<&str>, dep: &PluginDep) -> bool {
    version.is_some_and(|v| !dep.min.as_deref().is_some_and(|m| commands::older(v, m)))
}

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

#[derive(Debug, Clone)]
struct Resolved {
    owner: usize,
    label: String,
    ratio: f64,
    fit: Fit,
    hover: Option<Hover>,
    embed: Option<Embed>,
    /// 同じ part を sandbox と elevated の両方に書いたものは、両方を持つ。使うのは elevated。
    parts: HashMap<(Part, By), Handler>,
}

#[derive(Debug, Clone)]
struct Handler {
    plugin: usize,
    format: String,
}

#[derive(Debug, Clone)]
struct LinkResolved {
    plugin: usize,
    parts: Vec<Part>,
}

/// URL のホスト名ごとに受け持つプラグイン。画面に渡す。
#[derive(Debug, Clone, Serialize)]
pub struct LinkInfo {
    pub host: String,
    #[serde(flatten)]
    pub ui: UiRef,
    pub parts: Vec<Part>,
}

/// プラグインが足す画面。画面に渡す。
#[derive(Debug, Clone, Serialize)]
pub struct ScreenInfo {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub place: bool,
    pub window: WindowDecl,
    #[serde(flatten)]
    pub ui: UiRef,
}

/// 右クリックメニューに項目を足すプラグイン。ui は elevated が受け持つときの読み込み先。
#[derive(Debug, Clone)]
pub struct MenuSide {
    pub plugin: String,
    pub ui: Option<UiRef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiRef {
    pub plugin: String,
    pub module: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Cap {
    pub part: Part,
    pub by: By,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub ext: String,
    pub label: String,
    pub ratio: f64,
    pub fit: Fit,
    pub plugin: String,
    pub thumbnail: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_thumbnail: Option<UiRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_waveform: Option<UiRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover: Option<Hover>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_hover: Option<UiRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embed: Option<Embed>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_embed: Option<UiRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_link: Option<UiRef>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Active,
    Missing,
    /// フォルダはあるが、plugin.json を読めない。
    Broken,
    Blocked,
    Disabled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    pub description: String,
    pub builtin: bool,
    pub dev: bool,
    pub enabled: bool,
    pub state: State,
    pub required: Deps,
    pub optional: Deps,
    pub via: Vec<Via>,
    pub caps: Vec<Cap>,
    pub formats: Vec<String>,
    pub links: Vec<String>,
    pub screens: Vec<String>,
    pub permissions: Vec<String>,
    /// elevated を持つか。持つものは本体と同じ権限で動く。
    pub elevated: bool,
    pub fetch: Vec<String>,
    pub settings: Vec<SettingStatus>,
    pub problems: Vec<Problem>,
    #[serde(flatten)]
    pub follow: Follow,
}

/// GitHub から入れたものの、追っているリリースと更新の仕方。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Follow {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// 調べて分かった、最新のリリースのタグ。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest: Option<String>,
    pub prerelease: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandStatus {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Via {
    pub name: String,
    pub plugin: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Conflict {
    pub ext: String,
    pub plugins: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkConflict {
    pub host: String,
    pub plugins: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReport {
    pub plugins: Vec<PluginStatus>,
    pub commands: Vec<CommandStatus>,
    pub conflicts: Vec<Conflict>,
    pub link_conflicts: Vec<LinkConflict>,
}

pub struct Registry {
    plugins: Vec<Loaded>,
    formats: HashMap<String, Resolved>,
    conflicts: Vec<Conflict>,
    links: HashMap<String, LinkResolved>,
    link_conflicts: Vec<LinkConflict>,
    others: Vec<PluginStatus>,
    record: Record,
    stored: RwLock<HashMap<String, Stored>>,
    root: Option<PathBuf>,
    stopped: AtomicBool,
}

const DEFAULT_RATIO: f64 = 1.6;

pub fn builtin_ids() -> Vec<String> {
    builtin::ids()
}

impl Registry {
    pub fn builtin() -> Registry {
        let mut r = Registry {
            plugins: builtin::load(),
            formats: HashMap::new(),
            conflicts: Vec::new(),
            links: HashMap::new(),
            link_conflicts: Vec::new(),
            others: Vec::new(),
            record: Record::default(),
            stored: RwLock::new(HashMap::new()),
            root: None,
            stopped: AtomicBool::new(false),
        };
        r.resolve();
        r
    }

    pub fn open(root: &Path, dir: &Path, dev: Option<&Dev>) -> (Registry, Vec<String>) {
        let mut problems = Vec::new();
        let mut record = Record::read(&record::path(root)).unwrap_or_else(|e| {
            problems.push(e);
            Record::default()
        });
        let mut plugins = builtin::load();
        let mut others = Vec::new();
        let builtin_ids: HashSet<String> = plugins.iter().map(|p| p.manifest.id.clone()).collect();
        plugins.retain(|p| {
            let off = record
                .plugins
                .get(&p.manifest.id)
                .is_some_and(|e| e.disabled);
            if off {
                let mut s = idle(&p.manifest, false, false, None, Vec::new());
                s.builtin = true;
                others.push(s);
            }
            !off
        });
        let mut found = HashSet::new();
        let mut active = HashSet::new();
        let dev_found = dev.map(|d| d.plugins(&mut problems)).unwrap_or_default();
        for (manifest, at) in dev_found {
            let enabled = record.dev.contains(&manifest.id);
            if builtin_ids.contains(&manifest.id) {
                let e = error("組み込みプラグインと ID が重複しています".into());
                others.push(idle(&manifest, true, false, None, vec![e]));
            } else if !found.insert(manifest.id.clone()) {
                log::warn!("開発版の ID が重複しているので読まない: {}", manifest.id);
            } else {
                match at {
                    Ok(at) if enabled => {
                        active.insert(manifest.id.clone());
                        let mut p = load_external(manifest, at, &record::Entry::default());
                        p.dev = true;
                        plugins.push(p);
                    }
                    Ok(_) => others.push(idle(&manifest, true, false, None, Vec::new())),
                    Err(e) => {
                        let mut s = idle(&manifest, true, enabled, None, vec![e]);
                        if enabled {
                            s.state = State::Blocked;
                        }
                        others.push(s);
                    }
                }
            }
        }
        if record.dev.iter().any(|id| !found.contains(id)) {
            record.dev.retain(|id| found.contains(id));
            if let Err(e) = record::update(root, |r| r.dev.retain(|id| found.contains(id))) {
                problems.push(e);
            }
        }
        for (id, entry) in &record.plugins {
            if builtin_ids.contains(id) {
                continue;
            }
            if let Err(e) = install::check_id(id) {
                problems.push(e);
                continue;
            }
            let at = dir.join(id);
            match Manifest::read(&at) {
                Ok(manifest) if entry.disabled => {
                    others.push(idle(&manifest, false, false, Some(entry), Vec::new()));
                }
                Ok(manifest) if active.contains(id) => {
                    let w = Problem {
                        level: Level::Warning,
                        text: "同じ ID の開発版を使用しているため、使用していません".into(),
                    };
                    others.push(idle(&manifest, false, true, Some(entry), vec![w]));
                }
                Ok(manifest) => plugins.push(load_external(manifest, at, entry)),
                Err(e) => others.push(PluginStatus {
                    id: id.clone(),
                    name: id.clone(),
                    version: None,
                    recorded: entry.version.clone(),
                    source: entry.source.clone(),
                    description: String::new(),
                    builtin: false,
                    dev: false,
                    enabled: !entry.disabled,
                    state: if at.exists() {
                        State::Broken
                    } else {
                        State::Missing
                    },
                    required: Deps::default(),
                    optional: Deps::default(),
                    via: Vec::new(),
                    caps: Vec::new(),
                    formats: Vec::new(),
                    links: Vec::new(),
                    screens: Vec::new(),
                    permissions: Vec::new(),
                    elevated: false,
                    fetch: Vec::new(),
                    settings: Vec::new(),
                    problems: vec![error(if at.exists() {
                        format!("plugin.json を読み込めません：{e}")
                    } else {
                        "この端末にインストールされていません".into()
                    })],
                    follow: Follow::default(),
                }),
            }
        }
        block_unmet(&mut plugins);
        let stored = plugins
            .iter()
            .map(|p| {
                let id = p.manifest.id.clone();
                let s = record::stored_path(root, &id)
                    .and_then(|p| Stored::read(&p))
                    .unwrap_or_else(|e| {
                        problems.push(e);
                        Stored::default()
                    });
                (id, s)
            })
            .collect();
        let mut r = Registry {
            plugins,
            formats: HashMap::new(),
            conflicts: Vec::new(),
            links: HashMap::new(),
            link_conflicts: Vec::new(),
            others,
            record,
            stored: RwLock::new(stored),
            root: Some(root.to_owned()),
            stopped: AtomicBool::new(false),
        };
        r.resolve();
        (r, problems)
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }

    pub fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Relaxed)
    }

    fn resolve(&mut self) {
        let mut claims: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (i, p) in self.plugins.iter().enumerate().filter(|(_, p)| !p.blocked) {
            for ext in p.manifest.formats.keys() {
                claims.entry(ext.clone()).or_default().push(i);
            }
        }
        let mut claim: HashMap<String, usize> = HashMap::new();
        let mut conflicts = Vec::new();
        for (ext, by) in claims {
            // 外部のプラグインを組み込みより先に使う。同じ側に複数あるものは、どれも使わない
            let (outside, inside): (Vec<usize>, Vec<usize>) =
                by.iter().partition(|&&i| !self.plugins[i].builtin);
            let mut owner = None;
            for side in [outside, inside] {
                if side.is_empty() {
                    continue;
                }
                if let Some(o) = owner {
                    let text = format!(
                        "「.{ext}」は「{}」が対応しているため、使用していません",
                        self.name(o)
                    );
                    for &i in &side {
                        self.plugins[i].problems.push(Problem {
                            level: Level::Warning,
                            text: text.clone(),
                        });
                    }
                    continue;
                }
                if let [only] = side[..] {
                    owner = Some(only);
                    continue;
                }
                for &i in &side {
                    let others: Vec<String> = side
                        .iter()
                        .filter(|&&j| j != i)
                        .map(|&j| format!("「{}」", self.name(j)))
                        .collect();
                    self.plugins[i].problems.push(error(format!(
                        "「.{ext}」は{}も対応しているため、使用していません",
                        others.join("")
                    )));
                }
                conflicts.push(Conflict {
                    ext: ext.clone(),
                    plugins: side
                        .iter()
                        .map(|&i| self.plugins[i].manifest.id.clone())
                        .collect(),
                });
            }
            if let Some(o) = owner {
                claim.insert(ext, o);
            }
        }
        self.conflicts = conflicts;
        self.resolve_links();

        let mut formats = HashMap::new();
        let mut problems: Vec<(usize, Problem)> = Vec::new();
        for (ext, &owner) in &claim {
            let mut label = None;
            let mut ratio = None;
            let mut fit = None;
            let mut hover = None;
            let mut embed = None;
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
                embed = embed.or(decl.embed.filter(|&e| e != Embed::Unknown));
                let own: Vec<(Part, By)> = match &self.plugins[at].wasm {
                    Some(w) if decl.sandbox => w.parts().map(|p| (p, By::Sandbox)).collect(),
                    _ => Vec::new(),
                };
                for (part, by) in own
                    .into_iter()
                    .chain(decl.elevated.iter().map(|&p| (p, By::Elevated)))
                {
                    if part == Part::Unknown {
                        continue;
                    }
                    if part == Part::Menu {
                        problems.push((
                            at,
                            error(format!(
                                "「.{fmt}」の menu は使っていません。右クリックメニューは plugin.json の menu に書きます"
                            )),
                        ));
                        continue;
                    }
                    parts.entry((part, by)).or_insert_with(|| Handler {
                        plugin: at,
                        format: fmt.clone(),
                    });
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
            parts.retain(|&(_, by), h| match by {
                By::Sandbox => self.plugins[h.plugin].wasm.is_some(),
                By::Elevated => self.plugins[h.plugin].elevated.is_some(),
                By::Unknown => false,
            });
            formats.insert(
                ext.clone(),
                Resolved {
                    owner,
                    label: label.unwrap_or_else(|| ext.to_uppercase()),
                    ratio: ratio.unwrap_or(DEFAULT_RATIO),
                    fit: fit.unwrap_or(Fit::Center),
                    hover,
                    embed,
                    parts,
                },
            );
        }
        for (i, p) in self.plugins.iter_mut().enumerate() {
            if p.manifest.wants_sandbox() && p.wasm.is_none() && p.problems.is_empty() {
                p.problems.push(error(
                    "plugin.wasm が見つからないため、サムネイルと詳細表示を処理できません".into(),
                ));
            }
            if let Some(w) = &p.wasm {
                if p.manifest.formats.values().any(|d| d.sandbox) && w.parts().next().is_none() {
                    p.problems.push(error(
                        "formats で sandbox を true にしていますが、plugin.wasm はサムネイル・詳細表示・詳細の記述・内容のどれも export していません".into(),
                    ));
                }
                if p.manifest.menu_by(By::Sandbox) && !w.has(runtime::Role::Menu) {
                    p.problems.push(error(
                        "menu の by が sandbox ですが、plugin.wasm は menu と run-menu を export していません".into(),
                    ));
                }
            }
            p.problems.extend(misspelled(&p.manifest));
            if let Some(MenuDecl {
                formats: MenuFormats::Every(MenuEvery::Unknown),
                ..
            }) = &p.manifest.menu
            {
                p.problems.push(error(
                    "menu の formats には、拡張子の並びか all・files を書きます".into(),
                ));
            }
            if let Some(h) = &p.manifest.hooks.added {
                if matches!(h.formats, MenuFormats::Every(MenuEvery::Unknown)) {
                    p.problems.push(error(
                        "hooks の added の formats には、拡張子の並びか all・files を書きます"
                            .into(),
                    ));
                }
                if h.by != By::Sandbox {
                    p.problems.push(error(
                        "hooks の added の by には sandbox しか書けません".into(),
                    ));
                } else if p.wasm.as_ref().is_some_and(|w| !w.has(runtime::Role::Hook)) {
                    p.problems.push(error(
                        "hooks の added を書いていますが、plugin.wasm は hook を export していません"
                            .into(),
                    ));
                }
            }
            for x in p
                .manifest
                .permissions
                .iter()
                .filter(|x| !rules().permitted(x))
            {
                p.problems.push(error(format!(
                    "permissions の「{x}」は使えません（{} のどれか）",
                    rules().permissions.join("・")
                )));
            }
            for id in p.manifest.screens.keys().filter(|id| !screen_id_ok(id)) {
                p.problems.push(error(format!(
                    "画面の ID「{id}」には、英数字・ハイフン・下線しか使えません"
                )));
            }
            for h in p.manifest.fetch.iter().filter(|h| !fetch_host_ok(h)) {
                p.problems.push(error(format!(
                    "fetch の「{h}」は使えません（「example.com」のように、ドメイン名まで書きます）"
                )));
            }
            if p.manifest.wants_elevated() && p.elevated.is_none() && p.problems.is_empty() {
                p.problems.push(error(
                    "plugin.json の elevated のファイルが見つからないため、elevated の処理を使えません"
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

    fn resolve_links(&mut self) {
        let mut claims: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (i, p) in self.plugins.iter().enumerate().filter(|(_, p)| !p.blocked) {
            for host in p.manifest.links.keys() {
                claims.entry(host_key(host)).or_default().push(i);
            }
        }
        let mut links = HashMap::new();
        let mut conflicts = Vec::new();
        for (host, by) in claims {
            if let [only] = by[..] {
                let p = &self.plugins[only];
                let decl = p
                    .manifest
                    .links
                    .iter()
                    .find(|(h, _)| host_key(h) == host)
                    .map(|(_, d)| d.clone())
                    .unwrap_or_default();
                let mut parts = Vec::new();
                let mut bad = Vec::new();
                for part in decl.elevated {
                    if LINK_PARTS.contains(&part) {
                        parts.push(part);
                    } else if part != Part::Unknown {
                        bad.push(error(format!(
                            "「{host}」の links では {} を受け持てません",
                            format!("{part:?}").to_lowercase()
                        )));
                    }
                }
                let p = &mut self.plugins[only];
                p.problems.extend(bad);
                if p.elevated.is_some() {
                    links.insert(
                        host,
                        LinkResolved {
                            plugin: only,
                            parts,
                        },
                    );
                }
                continue;
            }
            for &i in &by {
                let others: Vec<String> = by
                    .iter()
                    .filter(|&&j| j != i)
                    .map(|&j| format!("「{}」", self.name(j)))
                    .collect();
                self.plugins[i].problems.push(error(format!(
                    "「{host}」は{}も対応しているため、使用していません",
                    others.join("")
                )));
            }
            conflicts.push(LinkConflict {
                host,
                plugins: by
                    .iter()
                    .map(|&i| self.plugins[i].manifest.id.clone())
                    .collect(),
            });
        }
        self.links = links;
        self.link_conflicts = conflicts;
    }

    pub fn links(&self) -> Vec<LinkInfo> {
        let mut out: Vec<LinkInfo> = self
            .links
            .iter()
            .filter_map(|(host, l)| {
                let p = &self.plugins[l.plugin];
                Some(LinkInfo {
                    host: host.clone(),
                    ui: UiRef {
                        plugin: p.manifest.id.clone(),
                        module: p.elevated.clone()?,
                    },
                    parts: l.parts.clone(),
                })
            })
            .collect();
        out.sort_by(|a, b| a.host.cmp(&b.host));
        out
    }

    pub fn screens(&self) -> Vec<ScreenInfo> {
        self.plugins
            .iter()
            .filter(|p| !p.blocked)
            .filter_map(|p| Some((p, p.elevated.clone()?)))
            .flat_map(|(p, module)| {
                p.manifest
                    .screens
                    .iter()
                    .filter(|(id, _)| screen_id_ok(id))
                    .map(move |(id, d)| ScreenInfo {
                        id: id.clone(),
                        label: d.label.clone(),
                        icon: d.icon.clone(),
                        place: d.place,
                        window: d.window,
                        ui: UiRef {
                            plugin: p.manifest.id.clone(),
                            module: module.clone(),
                        },
                    })
            })
            .collect()
    }

    /// 右クリックメニューに項目を足すプラグイン。targets（拡張子とノートか）のすべてを対象にするものだけを、並び順に返す。
    pub fn menus(&self, targets: &[(&str, bool)]) -> Vec<MenuSide> {
        if targets.is_empty() {
            return Vec::new();
        }
        (0..self.plugins.len())
            .filter(|&i| {
                targets
                    .iter()
                    .all(|&(ext, note)| self.menu_covers(i, ext, note))
            })
            .filter_map(|i| {
                let p = &self.plugins[i];
                let by = p.manifest.menu.as_ref()?.by;
                let ui = match by {
                    By::Sandbox => {
                        p.wasm.as_ref().filter(|w| w.has(runtime::Role::Menu))?;
                        None
                    }
                    By::Elevated => Some(UiRef {
                        plugin: p.manifest.id.clone(),
                        module: p.elevated.clone()?,
                    }),
                    By::Unknown => return None,
                };
                Some(MenuSide {
                    plugin: p.manifest.id.clone(),
                    ui,
                })
            })
            .collect()
    }

    /// プラグインが permissions に permission を書いたか。
    pub fn permits(&self, plugin: &str, permission: &str) -> bool {
        self.plugins
            .iter()
            .find(|p| p.manifest.id == plugin)
            .is_some_and(|p| p.manifest.permissions.iter().any(|x| x == permission))
    }

    /// ext のものを取り込んだときに呼ぶフック。プラグインの一覧の順。
    pub fn hooks_for(&self, ext: &str, note: bool) -> Vec<usize> {
        self.plugins
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                !p.blocked
                    && p.wasm.as_ref().is_some_and(|w| w.has(runtime::Role::Hook))
                    && p.manifest
                        .hooks
                        .added
                        .as_ref()
                        .is_some_and(|h| h.by == By::Sandbox && h.covers(ext, note))
            })
            .map(|(i, _)| i)
            .collect()
    }

    pub fn has_hooks(&self) -> bool {
        self.plugins
            .iter()
            .any(|p| !p.blocked && p.manifest.hooks.added.is_some())
    }

    pub fn plugin_name(&self, i: usize) -> &str {
        self.name(i)
    }

    fn menu_covers(&self, i: usize, ext: &str, note: bool) -> bool {
        let p = &self.plugins[i];
        !p.blocked
            && p.manifest
                .menu
                .as_ref()
                .is_some_and(|m| m.covers(ext, note))
    }

    /// plugin が host へ取りに行けるか。plugin が None のときは本体（どのホストにも行ける）。
    pub fn may_fetch(&self, plugin: Option<&str>, host: &str) -> Result<(), String> {
        let Some(id) = plugin else { return Ok(()) };
        let p = &self.plugins[self.index_of(id)?];
        let host = host_key(host);
        if p.manifest
            .fetch
            .iter()
            .any(|h| host_matches(&host_key(h), &host))
        {
            Ok(())
        } else {
            Err(format!(
                "プラグイン「{}」は「{host}」に接続できません（plugin.json の fetch に書いていません）",
                p.manifest.name
            ))
        }
    }

    pub fn link_of(&self, ext: &str) -> Option<UiRef> {
        self.ui_of(ext, Part::Link)
    }

    fn name(&self, i: usize) -> &str {
        &self.plugins[i].manifest.name
    }

    pub fn handles(&self, ext: &str, part: Part) -> Option<By> {
        let parts = &self.formats.get(ext)?.parts;
        [By::Elevated, By::Sandbox]
            .into_iter()
            .find(|&by| parts.contains_key(&(part, by)))
            .or_else(|| {
                let linked =
                    LINK_PARTS.contains(&part) && parts.contains_key(&(Part::Link, By::Elevated));
                linked.then_some(By::Elevated)
            })
    }

    /// URL ごとに受け持つもの（links のプラグインか本体）に回すか。
    pub fn by_link(&self, ext: &str, part: Part) -> bool {
        self.handles(ext, part) == Some(By::Elevated)
            && self.slot(ext, part, By::Elevated).is_none()
            && self.link_of(ext).is_some()
    }

    /// by が実際に使う担当のときだけ返す。
    fn part(&self, ext: &str, part: Part, by: By) -> Option<(usize, &str)> {
        (self.handles(ext, part)? == by).then_some(())?;
        self.slot(ext, part, by)
    }

    /// elevated があっても、sandbox の担当を返す。elevated の中から sandbox を呼ぶときに使う。
    fn slot(&self, ext: &str, part: Part, by: By) -> Option<(usize, &str)> {
        let h = self.formats.get(ext)?.parts.get(&(part, by))?;
        Some((h.plugin, h.format.as_str()))
    }

    pub fn ratio_of(&self, ext: &str) -> f64 {
        self.formats.get(ext).map_or(DEFAULT_RATIO, |f| f.ratio)
    }

    fn thumb_plugin(&self, ext: &str) -> Option<usize> {
        let by = self.handles(ext, Part::Thumbnail)?;
        Some(self.part(ext, Part::Thumbnail, by)?.0)
    }

    pub fn thumb_owner(&self, ext: &str) -> Option<&str> {
        Some(&self.plugins[self.thumb_plugin(ext)?].manifest.id)
    }

    pub fn thumb_setting(&self, ext: &str, key: &str) -> Value {
        self.thumb_plugin(ext)
            .and_then(|i| self.setting(i, key))
            .unwrap_or(Value::Null)
    }

    pub fn keeps_decoded(&self, ext: &str) -> Option<(&str, &str)> {
        let (i, format) = self.part(ext, Part::View, By::Sandbox)?;
        let on = self.setting(i, &keep_decoded_key(format)) == Some(Value::Bool(true));
        on.then(|| (self.plugins[i].manifest.id.as_str(), format))
    }

    pub fn ui_of(&self, ext: &str, part: Part) -> Option<UiRef> {
        let (i, _) = self.part(ext, part, By::Elevated)?;
        let p = &self.plugins[i];
        Some(UiRef {
            plugin: p.manifest.id.clone(),
            module: p.elevated.clone()?,
        })
    }

    /// content を作るプラグインの ID と版。elevated が呼べる sandbox のものも並べる。版が変われば区間を作り直す。
    pub fn content_owner(&self, ext: &str) -> Option<String> {
        let by = self.handles(ext, Part::Content)?;
        let mut out = Vec::new();
        for b in [by, By::Sandbox] {
            if let Some((i, _)) = self.slot(ext, Part::Content, b) {
                let m = &self.plugins[i].manifest;
                let s = format!("{}@{}", m.id, m.version);
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
        Some(out.join(","))
    }

    pub fn file(&self, id: &str, rel: &str) -> Option<Vec<u8>> {
        let p = self.plugins.iter().find(|p| p.manifest.id == id)?;
        match &p.dir {
            Some(dir) => files::read(dir, rel),
            None if p.builtin => builtin::file(id, rel).map(<[u8]>::to_vec),
            None => None,
        }
    }

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

    fn store(&self, i: usize, f: impl FnOnce(&mut Stored)) -> Result<(), String> {
        let root = self.root.as_ref().ok_or("ライブラリが開かれていません")?;
        let id = &self.plugins[i].manifest.id;
        let mut all = self.stored.write().map_err(|e| e.to_string())?;
        let s = all.entry(id.clone()).or_default();
        f(s);
        s.write(&record::stored_path(root, id)?)
    }

    fn data(&self, i: usize, key: &str) -> Option<String> {
        let all = self.stored.read().ok()?;
        let v = all.get(&self.plugins[i].manifest.id)?.data.get(key)?;
        v.as_str().map(str::to_owned)
    }

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

    pub fn data_of(&self, id: &str, key: &str) -> Result<Option<String>, String> {
        Ok(self.data(self.index_of(id)?, key))
    }

    pub fn set_data_of(&self, id: &str, key: &str, value: Option<String>) -> Result<(), String> {
        self.set_data(self.index_of(id)?, key, value)
    }

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
                thumbnail: self.handles(ext, Part::Thumbnail).is_some(),
                ui_thumbnail: self.ui_of(ext, Part::Thumbnail),
                ui_waveform: self.ui_of(ext, Part::Waveform),
                hover: f.hover,
                ui_hover: self.ui_of(ext, Part::Hover),
                embed: f.embed,
                ui_embed: self.ui_of(ext, Part::Embed),
                ui_link: self.link_of(ext),
            })
            .collect();
        out.sort_by(|a, b| a.ext.cmp(&b.ext));
        out
    }

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
                // elevated は依存先の関数を呼べるので、依存先が動かせるコマンドも見せる
                let via = if m.wants_elevated() {
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
                let mut formats: Vec<String> = if p.blocked {
                    m.formats.keys().cloned().collect()
                } else {
                    self.formats
                        .iter()
                        .filter(|(_, f)| f.owner == i)
                        .map(|(e, _)| e.clone())
                        .collect()
                };
                formats.sort();
                let mut links: Vec<String> = if p.blocked {
                    m.links.keys().map(|h| host_key(h)).collect()
                } else {
                    self.links
                        .iter()
                        .filter(|(_, l)| l.plugin == i)
                        .map(|(h, _)| h.clone())
                        .collect()
                };
                links.sort();
                let screens = screen_labels(m);
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
                    dev: p.dev,
                    enabled: true,
                    state: if p.blocked {
                        State::Blocked
                    } else {
                        State::Active
                    },
                    required: m.required.clone(),
                    optional: m.optional.clone(),
                    via,
                    caps: m.caps(p.wasm.as_deref()),
                    formats,
                    links,
                    screens,
                    permissions: permissions_of(m),
                    elevated: m.wants_elevated(),
                    fetch: fetch_of(m),
                    settings,
                    problems,
                    follow: Follow::default(),
                }
            })
            .collect();
        plugins.extend(self.others.iter().cloned());
        for p in plugins.iter_mut().filter(|p| !p.builtin && !p.dev) {
            if let Some(e) = self.record.plugins.get(&p.id) {
                p.follow.tag = e.tag.clone();
                p.follow.prerelease = e.prerelease;
            }
        }
        PluginReport {
            plugins,
            commands,
            conflicts: self.conflicts.clone(),
            link_conflicts: self.link_conflicts.clone(),
        }
    }
}

fn load_external(manifest: Manifest, dir: PathBuf, entry: &record::Entry) -> Loaded {
    let mut problems = Vec::new();
    let wasm_path = dir.join(WASM);
    let wasm = if wasm_path.is_file() {
        match fs::read(&wasm_path)
            .map_err(|e| e.to_string())
            .and_then(|b| runtime::Prepared::new(&b, &manifest))
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
    let elevated = manifest.elevated.clone().filter(|m| {
        let ok = inside(m) && dir.join(m).is_file();
        if !ok {
            problems.push(error(format!("elevated のファイル（{m}）が見つかりません")));
        }
        ok
    });
    let settings = settings_of(wasm.as_deref(), &manifest, &mut problems);
    Loaded {
        manifest,
        builtin: false,
        dir: Some(dir),
        wasm,
        elevated,
        settings,
        problems,
        source: entry.source.clone(),
        recorded: entry.version.clone(),
        blocked: false,
        dev: false,
    }
}

pub struct Dev {
    pub dirs: Vec<PathBuf>,
    pub repos: Vec<PathBuf>,
    pub unpack: PathBuf,
}

impl Dev {
    fn plugins(&self, problems: &mut Vec<String>) -> Vec<(Manifest, Result<PathBuf, Problem>)> {
        let mut out = Vec::new();
        for dir in &self.dirs {
            let Ok(entries) = fs::read_dir(dir) else {
                problems.push(format!("{}: フォルダが見つかりません", dir.display()));
                continue;
            };
            let mut found: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.join(MANIFEST).is_file())
                .collect();
            found.sort();
            for at in found {
                match Manifest::read(&at) {
                    Ok(m) => out.push((m, Ok(at))),
                    Err(e) => problems.push(e),
                }
            }
        }
        for repo in &self.repos {
            match Manifest::read(repo) {
                Ok(m) => {
                    let at = self.unpack_repo(repo, &m).map_err(error);
                    out.push((m, at));
                }
                Err(e) => problems.push(e),
            }
        }
        out
    }

    fn unpack_repo(&self, repo: &Path, m: &Manifest) -> Result<PathBuf, String> {
        let name = format!("{}-{}.zip", m.id, m.version);
        let zip = repo.join(&name);
        if !zip.is_file() {
            return Err(format!("{name} が見つかりません"));
        }
        let at = self
            .unpack
            .join(format!("{}-{}", m.id, uuid::Uuid::new_v4().simple()));
        install::unpack(&zip, &at)?;
        let inner = Manifest::read(&at)?;
        if inner.id != m.id {
            return Err(format!(
                "{name} の ID（{}）が plugin.json（{}）と異なります",
                inner.id, m.id
            ));
        }
        Ok(at)
    }
}

fn idle(
    m: &Manifest,
    dev: bool,
    enabled: bool,
    entry: Option<&record::Entry>,
    problems: Vec<Problem>,
) -> PluginStatus {
    PluginStatus {
        id: m.id.clone(),
        name: m.name.clone(),
        version: Some(m.version.clone()),
        recorded: entry.and_then(|e| e.version.clone()),
        source: entry.and_then(|e| e.source.clone()),
        description: m.description.clone(),
        builtin: false,
        dev,
        enabled,
        state: State::Disabled,
        required: m.required.clone(),
        optional: m.optional.clone(),
        via: Vec::new(),
        caps: m.caps(None),
        formats: m.formats.keys().cloned().collect(),
        links: m.links.keys().map(|h| host_key(h)).collect(),
        screens: screen_labels(m),
        permissions: permissions_of(m),
        elevated: m.wants_elevated(),
        fetch: fetch_of(m),
        settings: Vec::new(),
        problems,
        follow: Follow::default(),
    }
}

/// 書けない値を書いたところ。読み込みでは捨てて続けるので、ここで知らせる。
fn misspelled(m: &Manifest) -> Vec<Problem> {
    let mut out = Vec::new();
    for (ext, d) in &m.formats {
        if d.fit == Some(Fit::Unknown) {
            out.push(error(format!(
                "「.{ext}」の fit には center・top・contain のどれかを書きます"
            )));
        }
        if d.hover == Some(Hover::Unknown) {
            out.push(error(format!(
                "「.{ext}」の hover には video・audio のどちらかを書きます"
            )));
        }
        if d.embed == Some(Embed::Unknown) {
            out.push(error(format!(
                "「.{ext}」の embed には view・card のどちらかを書きます"
            )));
        }
        if d.elevated.contains(&Part::Unknown) {
            out.push(error(format!(
                "「.{ext}」の elevated に、受け持てないものが書かれています"
            )));
        }
    }
    for (host, d) in &m.links {
        if d.elevated.contains(&Part::Unknown) {
            out.push(error(format!(
                "「{host}」の links の elevated に、受け持てないものが書かれています"
            )));
        }
    }
    if m.menu.as_ref().is_some_and(|x| x.by == By::Unknown) {
        out.push(error(
            "menu の by には sandbox・elevated のどちらかを書きます".into(),
        ));
    }
    out
}

fn screen_id_ok(id: &str) -> bool {
    rules().screen_id.is_match(id)
}

fn permissions_of(m: &Manifest) -> Vec<String> {
    let mut out: Vec<String> = m
        .permissions
        .iter()
        .filter(|x| rules().permitted(x))
        .cloned()
        .collect();
    out.sort();
    out.dedup();
    out
}

fn fetch_of(m: &Manifest) -> Vec<String> {
    let mut out: Vec<String> = m
        .fetch
        .iter()
        .filter(|h| fetch_host_ok(h))
        .map(|h| host_key(h))
        .collect();
    out.sort();
    out.dedup();
    out
}

fn screen_labels(m: &Manifest) -> Vec<String> {
    m.screens.values().map(|d| d.label.clone()).collect()
}

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
