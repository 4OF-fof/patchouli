//! 組み込みのプラグイン。`plugin.json` と、処理の部分の WASM（build.rs が作る）を埋め込む。

use std::sync::{Arc, OnceLock};

use super::{Loaded, Manifest, error, runtime::Prepared, settings_of};

/// 読む順。同じ形式を受け持とうとしたときは、先のものを使う。
const ALL: [(&str, Option<&[u8]>); 4] = [
    (
        include_str!("../../../plugins/image/plugin.json"),
        Some(include_bytes!(concat!(env!("OUT_DIR"), "/image.wasm"))),
    ),
    (
        include_str!("../../../plugins/video/plugin.json"),
        Some(include_bytes!(concat!(env!("OUT_DIR"), "/video.wasm"))),
    ),
    (
        include_str!("../../../plugins/audio/plugin.json"),
        Some(include_bytes!(concat!(env!("OUT_DIR"), "/audio.wasm"))),
    ),
    (include_str!("../../../plugins/note/plugin.json"), None),
];

/// 処理の部分。ないものは None。
type Slot = Option<Result<Arc<Prepared>, String>>;

/// WASM を動かせるようにするのは時間がかかるので、最初の一度だけにする。
fn prepared() -> &'static [Slot] {
    static P: OnceLock<Vec<Slot>> = OnceLock::new();
    P.get_or_init(|| {
        ALL.iter()
            .map(|(_, wasm)| wasm.map(|b| Prepared::new(b).map(Arc::new)))
            .collect()
    })
}

pub(super) fn load() -> Vec<Loaded> {
    ALL.iter()
        .zip(prepared())
        .map(|((json, _), pre)| {
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
            let settings = settings_of(wasm.as_deref(), &manifest.id, &mut problems);
            Loaded {
                manifest,
                builtin: true,
                dir: None,
                wasm,
                ui: None,
                settings,
                problems,
                source: None,
                recorded: None,
                blocked: false,
            }
        })
        .collect()
}

pub(super) fn ids() -> Vec<String> {
    ALL.iter()
        .filter_map(|(json, _)| serde_json::from_str::<Manifest>(json).ok())
        .map(|m| m.id)
        .collect()
}
