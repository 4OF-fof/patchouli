wit_bindgen::generate!({
    inline: "
        package local:image;

        world image {
            include patchouli:plugin/thumbnail-role@0.13.0;
            include patchouli:plugin/details-role@0.13.0;
            include patchouli:plugin/excerpt-role@0.13.0;
        }
    ",
    path: "../sdk/wit",
    world: "local:image/image",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::types::{
    Detail, ExcerptBudget, ExcerptMedia, ExcerptPart, File, ThumbnailImage,
};
use patchouli::plugin::{commands, host};

#[path = "../../shared/frame.rs"]
mod frame;

struct Image;

/// 本体が読めない形式は、ffmpeg があればそちらで縮める。
fn shrink(f: &File, edge: u32) -> Result<Vec<u8>, String> {
    match host::image_thumbnail(f, edge) {
        Ok(png) => Ok(png),
        Err(e) if commands::available("ffmpeg") => {
            frame::frame(f, 0.0, edge).map_err(|e2| format!("{e} / {e2}"))
        }
        Err(e) => Err(e),
    }
}

impl role::thumbnail::Guest for Image {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<ThumbnailImage>, String> {
        let png = shrink(&f, edge)?;
        Ok(Some(ThumbnailImage {
            png,
            size: host::image_size(&f),
        }))
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

impl role::excerpt::Guest for Image {
    fn excerpt(
        _format: String,
        f: File,
        budget: ExcerptBudget,
    ) -> Result<Vec<ExcerptPart>, String> {
        let png = shrink(&f, budget.edge)?;
        Ok(vec![ExcerptPart {
            start: None,
            end: None,
            media: ExcerptMedia::Images(vec![png]),
        }])
    }
}

export!(Image);
