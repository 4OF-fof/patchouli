wit_bindgen::generate!({
    inline: "
        package local:image;

        world image {
            include patchouli:plugin/thumbnail-role@0.11.0;
            include patchouli:plugin/view-role@0.11.0;
            include patchouli:plugin/details-role@0.11.0;
            include patchouli:plugin/content-role@0.11.0;
        }
    ",
    path: "../sdk/wit",
    world: "local:image/image",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::types::{
    ContentBudget, ContentMedia, ContentPart, Detail, File, ThumbnailImage, ViewKind,
};
use patchouli::plugin::{commands, host};

#[path = "../../shared/frame.rs"]
mod frame;

struct Image;

impl role::thumbnail::Guest for Image {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<ThumbnailImage>, String> {
        let png = match host::image_thumbnail(&f, edge) {
            Ok(png) => png,
            Err(e) if commands::available("ffmpeg") => {
                frame::frame(&f, 0.0, edge).map_err(|e2| format!("{e} / {e2}"))?
            }
            Err(e) => return Err(e),
        };
        Ok(Some(ThumbnailImage {
            png,
            size: host::image_size(&f),
        }))
    }
}

impl role::view::Guest for Image {
    fn view(_format: String, _f: File) -> Option<ViewKind> {
        Some(ViewKind::Image)
    }

    fn decode(_format: String, _f: File) -> Result<Vec<u8>, String> {
        Err("decode には対応していません".into())
    }
}

impl role::details::Guest for Image {
    fn details(_format: String, f: File) -> Result<Vec<Detail>, String> {
        Ok(host::image_size(&f)
            .map(|d| Detail {
                label: "解像度".into(),
                value: format!("{} × {}", d.width, d.height),
            })
            .into_iter()
            .collect())
    }
}

impl role::content::Guest for Image {
    fn content(
        _format: String,
        f: File,
        budget: ContentBudget,
    ) -> Result<Vec<ContentPart>, String> {
        let png = match host::image_thumbnail(&f, budget.edge) {
            Ok(png) => png,
            Err(e) if commands::available("ffmpeg") => {
                frame::frame(&f, 0.0, budget.edge).map_err(|e2| format!("{e} / {e2}"))?
            }
            Err(e) => return Err(e),
        };
        Ok(vec![ContentPart {
            start: None,
            end: None,
            media: ContentMedia::Images(vec![png]),
        }])
    }
}

export!(Image);
