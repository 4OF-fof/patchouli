//! テキスト（組み込み UI の例）。サムネイルと詳細は ui.js が描き、WASM は設定の項目と、行数などを数える関数を持つ。

wit_bindgen::generate!({ world: "plugin", path: "../../app/plugins/wit" });

use patchouli::plugin::host;
use patchouli::plugin::types::{Choice, NumberRange, SettingKind, SettingValue};

struct Text;

impl Guest for Text {
    fn thumbnail(_format: String, _f: File, _edge: u32) -> Result<Option<Thumbnail>, String> {
        Ok(None)
    }

    fn view(_format: String, _f: File) -> Option<View> {
        None
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode はない".into())
    }

    fn settings() -> Vec<Setting> {
        vec![
            Setting {
                key: "wrap".into(),
                label: "折り返す".into(),
                help: None,
                kind: SettingKind::Toggle,
                default: SettingValue::Toggle(true),
            },
            Setting {
                key: "size".into(),
                label: "文字の大きさ".into(),
                help: Some("10 から 32 まで".into()),
                kind: SettingKind::Number(NumberRange {
                    min: Some(10.0),
                    max: Some(32.0),
                    step: Some(1.0),
                }),
                default: SettingValue::Number(14.0),
            },
            Setting {
                key: "font".into(),
                label: "字体".into(),
                help: None,
                kind: SettingKind::Choice(vec![
                    Choice {
                        value: "mono".into(),
                        label: "等幅".into(),
                    },
                    Choice {
                        value: "sans".into(),
                        label: "ゴシック".into(),
                    },
                ]),
                default: SettingValue::Text("mono".into()),
            },
        ]
    }

    /// stats: 行数・文字数・バイト数を JSON で返す。
    fn call(_format: String, f: File, method: String, _args: String) -> Result<String, String> {
        match method.as_str() {
            "stats" => {
                let bytes = host::read(&f, 0, 1 << 20)?;
                let text = String::from_utf8_lossy(&bytes);
                Ok(format!(
                    "{{\"lines\":{},\"chars\":{},\"bytes\":{}}}",
                    text.lines().count(),
                    text.chars().count(),
                    f.size
                ))
            }
            m => Err(format!("{m} はない")),
        }
    }
}

export!(Text);
