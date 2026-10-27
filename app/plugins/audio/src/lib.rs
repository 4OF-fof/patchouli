wit_bindgen::generate!({ world: "plugin", path: "../sdk/wit" });

#[path = "../../shared/frame.rs"]
mod frame;

#[path = "../../shared/clock.rs"]
mod clock;

mod analyze;
mod bpm;

struct Audio;

impl Guest for Audio {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        Ok(frame::frame(&f, 0.0, edge)
            .ok()
            .map(|png| Thumbnail { png, size: None }))
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Audio)
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode には対応していません".into())
    }

    fn details(format: String, f: File) -> Result<Vec<Detail>, String> {
        let a = analyze::analyze(&format, &f)?;
        let row = |label: &str, value: String| Detail {
            label: label.into(),
            value,
        };
        let bpm = a.bpm.map_or("—".into(), |b| format!("{b:.0}"));
        Ok(vec![row("BPM", bpm), row("再生時間", clock::clock(a.secs))])
    }

    fn settings() -> Vec<Setting> {
        Vec::new()
    }

    fn call(_format: String, _f: File, method: String, _args: String) -> Result<String, String> {
        Err(format!("{method} には対応していません"))
    }
}

export!(Audio);
