//! 動画。サムネイルはコマを 1 枚取り出して作り、詳細はアプリの動画の表示に出す。

wit_bindgen::generate!({ world: "plugin", path: "../wit" });

use patchouli::plugin::host;

struct Video;

impl Guest for Video {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        // 最初のコマは黒いことが多いので 1 秒目から取る。それより短ければ最初のコマ
        let png = host::frame(&f, 1.0, edge).or_else(|_| host::frame(&f, 0.0, edge))?;
        Ok(Some(Thumbnail { png, size: None }))
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Video)
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

export!(Video);
