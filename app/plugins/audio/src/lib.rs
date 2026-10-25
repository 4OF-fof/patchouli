//! 音声。ジャケットがあれば、それをサムネイルにする。詳細はアプリの音声の表示に出す。

wit_bindgen::generate!({ world: "plugin", path: "../wit" });

use patchouli::plugin::host;

struct Audio;

impl Guest for Audio {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        Ok(host::frame(&f, 0.0, edge)
            .ok()
            .map(|png| Thumbnail { png, size: None }))
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Audio)
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode はない".into())
    }

    fn settings() -> Vec<Setting> {
        Vec::new()
    }

    fn call(_format: String, _f: File, method: String, _args: String) -> Result<String, String> {
        Err(format!("{method} はない"))
    }
}

export!(Audio);
