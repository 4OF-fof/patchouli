use crate::excerpt::ffmpeg;
use crate::patchouli::plugin::types::File;

/// つながった JPEG を 1 枚ずつに分ける。FFmpeg の mjpeg は、画像の中に FF D9 を書かない。
fn split_jpeg(b: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut from = None;
    let mut i = 0;
    while i + 1 < b.len() {
        match (b[i], b[i + 1]) {
            (0xff, 0xd8) if from.is_none() => from = Some(i),
            (0xff, 0xd9) => {
                if let Some(s) = from.take() {
                    out.push(b[s..i + 2].to_vec());
                }
            }
            _ => {}
        }
        i += 1;
    }
    out
}

/// start から span 秒のあいだ、every 秒ごとのコマを count 枚まで。長いほうの辺は edge 以下の JPEG。
pub fn frames(
    f: &File,
    start: f64,
    span: f64,
    every: f64,
    count: u32,
    edge: u32,
) -> Result<Vec<Vec<u8>>, String> {
    let vf = format!(
        "fps=1/{every},scale='min({edge},iw)':'min({edge},ih)':force_original_aspect_ratio=decrease"
    );
    let n = count.max(1).to_string();
    let out = [
        "-an",
        "-vf",
        &vf,
        "-frames:v",
        &n,
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-q:v",
        "4",
        "-",
    ];
    Ok(split_jpeg(&ffmpeg(f, start, span, &out)?))
}
