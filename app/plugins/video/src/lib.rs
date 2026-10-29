wit_bindgen::generate!({ world: "plugin", path: "../sdk/wit" });

#[path = "../../shared/clock.rs"]
mod clock;
#[path = "../../shared/frame.rs"]
mod frame;
#[path = "../../shared/probe.rs"]
mod probe;

struct Video;

impl Guest for Video {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        // 最初のコマは黒いことが多いので 1 秒目から取る。それより短ければ最初のコマ
        let png = frame::frame(&f, 1.0, edge).or_else(|_| frame::frame(&f, 0.0, edge))?;
        Ok(Some(Thumbnail { png, size: None }))
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Video)
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode には対応していません".into())
    }

    fn details(_format: String, f: File) -> Result<Vec<Detail>, String> {
        let Some(p) = probe::probe(&f) else {
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

    fn menu(_format: String, _f: File) -> Result<Vec<MenuItem>, String> {
        Ok(Vec::new())
    }

    fn run_menu(_format: String, _f: File, id: String) -> Result<Option<String>, String> {
        Err(format!("{id} には対応していません"))
    }

    fn settings() -> Vec<Setting> {
        Vec::new()
    }

    fn call(_format: String, _f: File, method: String, _args: String) -> Result<String, String> {
        Err(format!("{method} には対応していません"))
    }
}

export!(Video);
