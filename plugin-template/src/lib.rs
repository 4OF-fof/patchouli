//! プラグインの WASM 実装。wasm32-wasip2 ターゲットで WASM コンポーネントにビルドされ、アプリ本体から呼び出される。
//! インターフェースと型の定義は patchouli/wit/plugin.wit にある。
//! このサンプルではサムネイルと詳細表示を ui.ts で描画し、WASM 側では設定項目と行列数の集計関数を実装している。

// 対応するロールの world を include でまとめる。ロールと world の一覧は plugin.wit を参照
wit_bindgen::generate!({
    inline: "
        package local:csv;

        world csv {
            include patchouli:plugin/settings-role@0.13.0;
            include patchouli:plugin/call-role@0.13.0;
        }
    ",
    path: "patchouli/wit",
    world: "local:csv/csv",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::host;
use patchouli::plugin::types::{File, Setting, SettingKind, SettingValue};
use serde::Serialize;

struct Csv;

/// call("summary") が返すもの。ui.ts の Summary と合わせる。
#[derive(Serialize)]
struct Summary {
    rows: usize,
    columns: usize,
}

impl role::settings::Guest for Csv {
    /// ui.ts の settings の型と合わせる。
    fn settings() -> Vec<Setting> {
        vec![Setting {
            key: "header".into(),
            label: "1 行目を見出しとして表示".into(),
            help: None,
            kind: SettingKind::Toggle,
            default: SettingValue::Toggle(true),
        }]
    }
}

impl role::call::Guest for Csv {
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
