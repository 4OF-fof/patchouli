//! 画像。縮めるのも大きさを読むのもアプリに任せ、詳細はアプリの画像の表示に出す。

wit_bindgen::generate!({ world: "plugin", path: "../wit" });

use patchouli::plugin::host;

#[path = "../../shared/frame.rs"]
mod frame;

struct Image;

impl Guest for Image {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        let png = match host::image_thumbnail(&f, edge) {
            Ok(png) => png,
            // アプリが読めない形式（avif など）は、FFmpeg か OS の機能で読む
            Err(e) => frame::frame(&f, 0.0, edge).map_err(|e2| format!("{e} / {e2}"))?,
        };
        Ok(Some(Thumbnail {
            png,
            size: host::image_size(&f),
        }))
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Image)
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

export!(Image);
