wit_bindgen::generate!({ world: "plugin", path: "../sdk/wit" });

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

#[path = "../../shared/clock.rs"]
mod clock;
#[path = "../../shared/frame.rs"]
mod frame;
mod meta;
#[path = "../../shared/probe.rs"]
mod probe;

struct Video;

impl Guest for Video {
    fn thumbnail(_format: String, _f: File, _edge: u32) -> Result<Option<Thumbnail>, String> {
        Ok(None)
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Video)
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode には対応していません".into())
    }

    fn details(_format: String, f: File) -> Result<Vec<Detail>, String> {
        let Some(p) = meta::meta(&f).or_else(|| probe::probe(&f)) else {
            return Ok(Vec::new());
        };
        let size = p.size.map(|(w, h)| Detail {
            label: "解像度".into(),
            value: format!("{w} × {h}"),
        });
        let secs = p.secs.map(|s| Detail {
            label: "再生時間".into(),
            value: clock::clock(s),
        });
        Ok(size.into_iter().chain(secs).collect())
    }

    fn menu(_targets: Vec<Target>) -> Result<Vec<MenuItem>, String> {
        Ok(Vec::new())
    }

    fn run_menu(_targets: Vec<Target>, id: String) -> Result<Option<String>, String> {
        Err(format!("{id} には対応していません"))
    }

    fn settings() -> Vec<Setting> {
        Vec::new()
    }

    /// frame：WebView で読めなかったものを FFmpeg で取り出す。PNG を base64 にした JSON の文字列を返す。
    fn call(_format: String, f: File, method: String, args: String) -> Result<String, String> {
        if method != "frame" {
            return Err(format!("{method} には対応していません"));
        }
        let edge = args.trim().parse::<u32>().map_err(|e| e.to_string())?;
        // 最初のコマは黒いことが多いので 1 秒目から取る。それより短ければ最初のコマ
        let png = frame::frame(&f, 1.0, edge).or_else(|_| frame::frame(&f, 0.0, edge))?;
        Ok(format!("\"{}\"", STANDARD.encode(png)))
    }
}

export!(Video);
