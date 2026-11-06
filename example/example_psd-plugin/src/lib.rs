//! PSD の合成画像をサムネイルと詳細に出し、解像度・色・ビット数・レイヤー数を詳細に足す。
//! アプリは PSD を読めないので、詳細は view の decode で PNG にする。

wit_bindgen::generate!({
    inline: "
        package local:psd;

        world psd {
            include patchouli:plugin/thumbnail-role@0.13.0;
            include patchouli:plugin/view-role@0.13.0;
            include patchouli:plugin/details-role@0.13.0;
        }
    ",
    path: "../../app/plugins/sdk/wit",
    world: "local:psd/psd",
    generate_all,
});

mod psd;

use exports::patchouli::plugin as role;
use patchouli::plugin::types::{Detail, Dimensions, File, ThumbnailImage};

struct Psd;

fn png(img: &psd::Image) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut e = ::png::Encoder::new(&mut out, img.width, img.height);
    e.set_color(if img.alpha {
        ::png::ColorType::Rgba
    } else {
        ::png::ColorType::Rgb
    });
    e.set_depth(::png::BitDepth::Eight);
    // 詳細では大きな画像を毎回作るので、縮める速さを優先する
    e.set_compression(::png::Compression::Fast);
    let mut w = e.write_header().map_err(|e| e.to_string())?;
    w.write_image_data(&img.pixels).map_err(|e| e.to_string())?;
    w.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

impl role::thumbnail::Guest for Psd {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<ThumbnailImage>, String> {
        let p = psd::read(&f)?;
        let img = psd::image(&f, &p, Some(edge))?;
        Ok(Some(ThumbnailImage {
            png: png(&img)?,
            size: Some(Dimensions {
                width: p.width,
                height: p.height,
            }),
        }))
    }
}

impl role::view::Guest for Psd {
    fn decode(_format: String, f: File) -> Result<Vec<u8>, String> {
        let p = psd::read(&f)?;
        png(&psd::image(&f, &p, None)?)
    }
}

impl role::details::Guest for Psd {
    fn details(_format: String, f: File) -> Result<Vec<Detail>, String> {
        let p = psd::read(&f)?;
        let row = |label: &str, value: String| Detail {
            label: label.into(),
            value,
        };
        Ok(vec![
            row("解像度", format!("{} × {}", p.width, p.height)),
            row("色", p.mode.label().into()),
            row("ビット数", format!("{} ビット", p.depth)),
            row("レイヤー", p.layers.to_string()),
        ])
    }
}

export!(Psd);
