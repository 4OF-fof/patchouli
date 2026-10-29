wit_bindgen::generate!({ world: "plugin", path: "../sdk/wit" });

use patchouli::plugin::host;

#[path = "../../shared/frame.rs"]
mod frame;

struct Image;

impl Guest for Image {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        let png = match host::image_thumbnail(&f, edge) {
            Ok(png) => png,
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
        Err("decode には対応していません".into())
    }

    fn details(_format: String, f: File) -> Result<Vec<Detail>, String> {
        Ok(host::image_size(&f)
            .map(|d| Detail {
                label: "解像度".into(),
                value: format!("{} × {}", d.width, d.height),
            })
            .into_iter()
            .collect())
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

    fn call(_format: String, _f: File, method: String, _args: String) -> Result<String, String> {
        Err(format!("{method} には対応していません"))
    }
}

export!(Image);
