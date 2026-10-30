use crate::File;
use crate::patchouli::plugin::host::{self, CommandArg};

pub fn frame(f: &File, at: f64, edge: u32) -> Result<Vec<u8>, String> {
    if !host::command_available("ffmpeg") {
        return Err("この形式を読むには FFmpeg が必要です".into());
    }
    let t = |s: &str| CommandArg::Text(s.to_owned());
    let scale =
        format!("scale='min({edge},iw)':'min({edge},ih)':force_original_aspect_ratio=decrease");
    let at = format!("{at:.3}");
    let args = vec![
        t("-hide_banner"),
        t("-v"),
        t("error"),
        t("-nostdin"),
        t("-ss"),
        t(&at),
        t("-i"),
        CommandArg::File(f.clone()),
        t("-frames:v"),
        t("1"),
        t("-vf"),
        t(&scale),
        t("-f"),
        t("image2pipe"),
        t("-c:v"),
        t("png"),
        t("-"),
    ];
    let out = host::run_command("ffmpeg", &args, None)?;
    if out.code != Some(0) || out.stdout.is_empty() {
        return Err(format!(
            "FFmpeg でのフレームの取り出しに失敗しました：{}",
            out.stderr.trim()
        ));
    }
    Ok(out.stdout)
}
