wit_bindgen::generate!({
    inline: "
        package local:video;

        world video {
            include patchouli:plugin/thumbnail-role@0.11.0;
            include patchouli:plugin/view-role@0.11.0;
            include patchouli:plugin/details-role@0.11.0;
            include patchouli:plugin/content-role@0.11.0;
            include patchouli:plugin/call-role@0.11.0;
        }
    ",
    path: "../sdk/wit",
    world: "local:video/video",
    generate_all,
});

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use exports::patchouli::plugin as role;
use patchouli::plugin::commands;
use patchouli::plugin::types::{
    ContentBudget, ContentPart, Detail, Dimensions, File, ThumbnailImage, ViewKind,
};

#[path = "../../shared/clock.rs"]
mod clock;
#[path = "../../shared/content.rs"]
mod content;
#[path = "../../shared/frame.rs"]
mod frame;
mod frames;
mod meta;
#[path = "../../shared/pcm.rs"]
mod pcm;
#[path = "../../shared/probe.rs"]
mod probe;

struct Video;

impl role::thumbnail::Guest for Video {
    /// elevated が WebView で読めなかったときに呼ぶ。FFmpeg でコマを取り出す。
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<ThumbnailImage>, String> {
        // 最初のコマは黒いことが多いので 1 秒目から取る。それより短ければ最初のコマ
        let png = frame::frame(&f, 1.0, edge).or_else(|_| frame::frame(&f, 0.0, edge))?;
        let size = meta::meta(&f)
            .or_else(|| probe::probe(&f))
            .and_then(|p| p.size)
            .map(|(width, height)| Dimensions { width, height });
        Ok(Some(ThumbnailImage { png, size }))
    }
}

impl role::view::Guest for Video {
    fn view(_format: String, _f: File) -> Option<ViewKind> {
        Some(ViewKind::Video)
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode には対応していません".into())
    }
}

impl role::details::Guest for Video {
    fn details(_format: String, f: File) -> Result<Vec<Detail>, String> {
        let Some(p) = probed(&f) else {
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
}

impl role::content::Guest for Video {
    /// 音声トラックだけを返す。コマは elevated が WebView で取る。
    fn content(format: String, f: File, budget: ContentBudget) -> Result<Vec<ContentPart>, String> {
        match pcm::audio(&format, &f, &budget) {
            Ok(parts) => Ok(parts),
            Err(_) if commands::available("ffmpeg") => {
                Ok(content::audio(&f, probed(&f).and_then(|p| p.secs), &budget))
            }
            Err(_) => Ok(Vec::new()),
        }
    }
}

impl role::call::Guest for Video {
    /// WebView で読めなかったもののために、elevated から呼ぶ。
    /// secs：長さ（秒）。わからなければ null。
    /// frames：区間のコマを FFmpeg で取り出す。args は「start,span,every,count,edge」の JSON の文字列で、
    /// JPEG を base64 にした配列の JSON を返す。
    fn call(_format: String, f: File, method: String, args: String) -> Result<String, String> {
        if method == "secs" {
            return Ok(probed(&f)
                .and_then(|p| p.secs)
                .map_or("null".into(), |s| s.to_string()));
        }
        if method != "frames" {
            return Err(format!("{method} には対応していません"));
        }
        let n: Vec<f64> = args
            .trim()
            .trim_matches('"')
            .split(',')
            .map(|s| s.trim().parse::<f64>().map_err(|e| e.to_string()))
            .collect::<Result<_, _>>()?;
        let [start, span, every, count, edge] = n[..] else {
            return Err("frames の引数は「start,span,every,count,edge」です".into());
        };
        let jpegs = frames::frames(&f, start, span, every, count as u32, edge as u32)?;
        let items: Vec<String> = jpegs
            .iter()
            .map(|b| format!("\"{}\"", STANDARD.encode(b)))
            .collect();
        Ok(format!("[{}]", items.join(",")))
    }
}

fn probed(f: &File) -> Option<probe::Probe> {
    meta::meta(f).or_else(|| probe::probe(f))
}

export!(Video);
