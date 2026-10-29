wit_bindgen::generate!({ world: "plugin", path: "../../app/plugins/sdk/wit" });

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
        Err("decode には対応していません".into())
    }

    fn details(_format: String, _f: File) -> Result<Vec<Detail>, String> {
        Ok(Vec::new())
    }

    fn menu(_format: String, _f: File) -> Result<Vec<MenuItem>, String> {
        Ok(vec![MenuItem {
            id: "count".into(),
            label: "行数と文字数を表示".into(),
        }])
    }

    fn run_menu(_format: String, f: File, id: String) -> Result<Option<String>, String> {
        match id.as_str() {
            "count" => {
                let bytes = host::read(&f, 0, 1 << 20)?;
                let text = String::from_utf8_lossy(&bytes);
                Ok(Some(format!(
                    "{} 行・{} 文字",
                    text.lines().count(),
                    text.chars().count()
                )))
            }
            id => Err(format!("{id} には対応していません")),
        }
    }

    fn settings() -> Vec<Setting> {
        vec![
            Setting {
                key: "wrap".into(),
                label: "行を折り返す".into(),
                help: None,
                kind: SettingKind::Toggle,
                default: SettingValue::Toggle(true),
            },
            Setting {
                key: "size".into(),
                label: "文字サイズ".into(),
                help: Some("10〜32 px".into()),
                kind: SettingKind::Number(NumberRange {
                    min: Some(10.0),
                    max: Some(32.0),
                    step: Some(1.0),
                }),
                default: SettingValue::Number(14.0),
            },
            Setting {
                key: "font".into(),
                label: "フォント".into(),
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
            m => Err(format!("{m} には対応していません")),
        }
    }
}

export!(Text);
