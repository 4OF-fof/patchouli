//! 組み込みのプラグイン。`plugin.json` と、処理の部分の WASM と、組み込み UI のファイル（どちらも build.rs が作る）を埋め込む。

use std::sync::{Arc, OnceLock};

use super::{Loaded, Manifest, error, files, runtime::Prepared, settings_of};

/// 読む順（ディレクトリ名、plugin.json、WASM）。同じ形式を受け持とうとしたときは、先のものを使う。
const ALL: [(&str, &str, Option<&[u8]>); 4] = [
    (
        "image",
        include_str!("../../../plugins/image/plugin.json"),
        Some(include_bytes!(concat!(env!("OUT_DIR"), "/image.wasm"))),
    ),
    (
        "video",
        include_str!("../../../plugins/video/plugin.json"),
        Some(include_bytes!(concat!(env!("OUT_DIR"), "/video.wasm"))),
    ),
    (
        "audio",
        include_str!("../../../plugins/audio/plugin.json"),
        Some(include_bytes!(concat!(env!("OUT_DIR"), "/audio.wasm"))),
    ),
    (
        "note",
        include_str!("../../../plugins/note/plugin.json"),
        None,
    ),
];

/// 組み込み UI のファイル（ディレクトリ名、plugin.json からのパス、中身）。build.rs がビルドして並べる。
const UI_FILES: &[(&str, &str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/ui_files.rs"));

/// ディレクトリ名が dir のプラグインの、plugin.json からのパスが rel のファイル。
fn embedded(dir: &str, rel: &str) -> Option<&'static [u8]> {
    let rel = files::normal(rel)?;
    UI_FILES
        .iter()
        .find(|(d, r, _)| *d == dir && *r == rel)
        .map(|(_, _, b)| *b)
}

/// 組み込みのプラグイン id のファイル。
pub(super) fn file(id: &str, rel: &str) -> Option<&'static [u8]> {
    static DIRS: OnceLock<Vec<(String, &str)>> = OnceLock::new();
    let dirs = DIRS.get_or_init(|| {
        ALL.iter()
            .filter_map(|(dir, json, _)| {
                Some((serde_json::from_str::<Manifest>(json).ok()?.id, *dir))
            })
            .collect()
    });
    let (_, dir) = dirs.iter().find(|(i, _)| i == id)?;
    embedded(dir, rel)
}

/// 処理の部分。ないものは None。
type Slot = Option<Result<Arc<Prepared>, String>>;

/// WASM を動かせるようにするのは時間がかかるので、最初の一度だけにする。
fn prepared() -> &'static [Slot] {
    static P: OnceLock<Vec<Slot>> = OnceLock::new();
    P.get_or_init(|| {
        ALL.iter()
            .map(|(_, _, wasm)| wasm.map(|b| Prepared::new(b).map(Arc::new)))
            .collect()
    })
}

pub(super) fn load() -> Vec<Loaded> {
    ALL.iter()
        .zip(prepared())
        .map(|((dir, json, _), pre)| {
            let manifest: Manifest =
                serde_json::from_str(json).expect("組み込みのプラグインの plugin.json が読めない");
            let mut problems = Vec::new();
            let wasm = match pre {
                Some(Ok(p)) => Some(Arc::clone(p)),
                Some(Err(e)) => {
                    problems.push(error(format!("plugin.wasm の読み込みに失敗しました：{e}")));
                    None
                }
                None => None,
            };
            let ui = manifest.ui.clone().filter(|m| {
                let ok = embedded(dir, m).is_some();
                if !ok {
                    problems.push(error(format!(
                        "UI ファイル（{m}）が見つかりません（組み込みのプラグインは build.rs の UI_PLUGINS に書いたものだけビルドします）"
                    )));
                }
                ok
            });
            let settings = settings_of(wasm.as_deref(), &manifest, &mut problems);
            Loaded {
                manifest,
                builtin: true,
                dir: None,
                wasm,
                ui,
                settings,
                problems,
                source: None,
                recorded: None,
                blocked: false,
                dev: false,
            }
        })
        .collect()
}

pub(super) fn ids() -> Vec<String> {
    ALL.iter()
        .filter_map(|(_, json, _)| serde_json::from_str::<Manifest>(json).ok())
        .map(|m| m.id)
        .collect()
}
