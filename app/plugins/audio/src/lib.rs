wit_bindgen::generate!({
    inline: "
        package local:audio;

        world audio {
            include patchouli:plugin/thumbnail-role@0.13.0;
            include patchouli:plugin/details-role@0.13.0;
            include patchouli:plugin/excerpt-role@0.13.0;
        }
    ",
    path: "../sdk/wit",
    world: "local:audio/audio",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::commands;
use patchouli::plugin::types::{Detail, ExcerptBudget, ExcerptPart, File, ThumbnailImage};

#[path = "../../shared/frame.rs"]
mod frame;

#[path = "../../shared/clock.rs"]
mod clock;
#[path = "../../shared/excerpt.rs"]
mod excerpt;
#[path = "../../shared/pcm.rs"]
mod pcm;

mod analyze;
mod bpm;
mod cover;

struct Audio;

impl role::thumbnail::Guest for Audio {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<ThumbnailImage>, String> {
        let png = match cover::cover(&f, edge) {
            Ok(Some(png)) => Some(png),
            _ => frame::frame(&f, 0.0, edge).ok(),
        };
        Ok(png.map(|png| ThumbnailImage { png, size: None }))
    }
}

impl role::details::Guest for Audio {
    fn details(format: String, f: File) -> Result<Vec<Detail>, String> {
        let a = analyze::analyze(&format, &f)?;
        let row = |label: &str, value: String| Detail {
            label: label.into(),
            value,
        };
        let bpm = a.bpm.map_or("—".into(), |b| format!("{b:.0}"));
        let kbps = a.kbps.map_or("—".into(), |k| format!("{k:.0} kbps"));
        Ok(vec![
            row("BPM", bpm),
            row("再生時間", clock::clock(a.secs)),
            row("ビットレート", kbps),
        ])
    }
}

impl role::excerpt::Guest for Audio {
    fn excerpt(format: String, f: File, budget: ExcerptBudget) -> Result<Vec<ExcerptPart>, String> {
        match pcm::audio(&format, &f, &budget) {
            Ok(parts) => Ok(parts),
            Err(_) if commands::available("ffmpeg") => Ok(excerpt::audio(&f, None, &budget)),
            Err(e) => Err(e),
        }
    }
}

export!(Audio);
