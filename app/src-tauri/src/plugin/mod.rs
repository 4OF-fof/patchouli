mod builtin;
pub mod commands;
pub mod files;
pub mod install;
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
pub use runtime::{Runner, ViewOut, read, set_compiled_dir};

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
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hover {
    Video,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum By {
    Wasm,
    Ui,
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
    #[serde(default)]
    pub parts: Vec<Part>,
    #[serde(default)]
    pub ui: Vec<Part>,
    #[serde(default)]
    pub keep_decoded: bool,
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
    ui: Option<String>,
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
    parts: HashMap<Part, Handler>,
}

#[derive(Debug, Clone)]
struct Handler {
    plugin: usize,
    format: String,
    by: By,
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
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Active,
    Missing,
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
    pub settings: Vec<SettingStatus>,
    pub problems: Vec<Problem>,
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
#[serde(rename_all = "camelCase")]
pub struct PluginReport {
    pub plugins: Vec<PluginStatus>,
    pub commands: Vec<CommandStatus>,
}

pub struct Registry {
    plugins: Vec<Loaded>,
    formats: HashMap<String, Resolved>,
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
                Err(_) => others.push(PluginStatus {
                    id: id.clone(),
                    name: id.clone(),
                    version: None,
                    recorded: entry.version.clone(),
                    source: entry.source.clone(),
                    description: String::new(),
                    builtin: false,
                    dev: false,
                    enabled: !entry.disabled,
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
                    embed,
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

    pub fn handles(&self, ext: &str, part: Part) -> Option<By> {
        Some(self.formats.get(ext)?.parts.get(&part)?.by)
    }

    fn part(&self, ext: &str, part: Part, by: By) -> Option<(usize, &str)> {
        let h = self.formats.get(ext)?.parts.get(&part)?;
        (h.by == by).then_some((h.plugin, h.format.as_str()))
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
        let (i, format) = self.part(ext, Part::View, By::Wasm)?;
        let on = self.setting(i, &keep_decoded_key(format)) == Some(Value::Bool(true));
        on.then(|| (self.plugins[i].manifest.id.as_str(), format))
    }

    pub fn ui_of(&self, ext: &str, part: Part) -> Option<UiRef> {
        let (i, _) = self.part(ext, part, By::Ui)?;
        let p = &self.plugins[i];
        Some(UiRef {
            plugin: p.manifest.id.clone(),
            module: p.ui.clone()?,
        })
    }

    pub fn file(&self, id: &str, rel: &str) -> Option<Vec<u8>> {
        let p = self.plugins.iter().find(|p| p.manifest.id == id)?;
        match &p.dir {
            Some(dir) => files::read(dir, rel),
            None if p.builtin => builtin::file(id, rel).map(<[u8]>::to_vec),
            None => None,
        }
    }

    pub fn source_of(&self, id: &str) -> Option<(Source, Option<String>)> {
        let e = self.record.plugins.get(id)?;
        Some((e.source.clone()?, e.hash.clone()))
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
        s.write(&record::stored_path(root, id))
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
                thumbnail: f.parts.contains_key(&Part::Thumbnail),
                ui_thumbnail: self.ui_of(ext, Part::Thumbnail),
                ui_waveform: self.ui_of(ext, Part::Waveform),
                hover: f.hover,
                ui_hover: self.ui_of(ext, Part::Hover),
                embed: f.embed,
                ui_embed: self.ui_of(ext, Part::Embed),
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
        caps: m.caps(),
        formats: m.formats.keys().cloned().collect(),
        settings: Vec::new(),
        problems,
    }
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
