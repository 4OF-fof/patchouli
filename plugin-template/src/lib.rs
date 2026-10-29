//! プラグインの処理部分。wasm32-wasip2 で WASM のコンポーネントにし、アプリが動かす。
//! 関数と型の説明は patchouli/wit/plugin.wit にある。
//! この例では、サムネイルと詳細は ui.ts が描き、WASM は設定の項目と、行と列を数える関数を持つ。

wit_bindgen::generate!({ world: "plugin", path: "patchouli/wit" });

use patchouli::plugin::host;
use patchouli::plugin::types::{SettingKind, SettingValue};
use serde::Serialize;

struct Csv;

/// call("summary") が返すもの。ui.ts の Summary と合わせる。
#[derive(Serialize)]
struct Summary {
    rows: usize,
    columns: usize,
}

impl Guest for Csv {
    fn thumbnail(_format: String, _f: File, _edge: u32) -> Result<Option<Thumbnail>, String> {
        Ok(None)
    }

    fn view(_format: String, _f: File) -> Option<View> {
        None
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode には対応していません".into())
    }

    /// ui.ts の settings の型と合わせる。
    fn details(_format: String, _f: File) -> Result<Vec<Detail>, String> {
        Ok(Vec::new())
    }

    fn menu(_format: String, _f: File) -> Result<Vec<MenuItem>, String> {
        Ok(Vec::new())
    }

    fn run_menu(_format: String, _f: File, id: String) -> Result<Option<String>, String> {
        Err(format!("{id} には対応していません"))
    }

    fn settings() -> Vec<Setting> {
        vec![Setting {
            key: "header".into(),
            label: "1 行目を見出しとして表示".into(),
            help: None,
            kind: SettingKind::Toggle,
            default: SettingValue::Toggle(true),
        }]
    }

    /// ui.ts の api.call から呼ばれる。args と戻り値は JSON。
    fn call(_format: String, f: File, method: String, _args: String) -> Result<String, String> {
        match method.as_str() {
            "summary" => {
                let bytes = host::read(&f, 0, 1 << 20)?;
                let text = String::from_utf8_lossy(&bytes);
                let lines: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
                let summary = Summary {
                    rows: lines.len(),
                    columns: lines.first().map_or(0, |l| l.split(',').count()),
                };
                serde_json::to_string(&summary).map_err(|e| e.to_string())
            }
            m => Err(format!("{m} には対応していません")),
        }
    }
}

export!(Csv);
