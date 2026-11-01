use crate::File;
use crate::patchouli::plugin::host::{self, CommandArg};
use crate::patchouli::plugin::types::{ContentBudget, ContentMedia, ContentPart};

/// 1 回の FFmpeg の待ち時間。
const TIMEOUT: u32 = 60_000;

/// secs を len 秒ずつに分けた区間の始まり。max より多ければ、全体から均等に max 個選ぶ。
pub fn starts(secs: f64, len: f64, max: u32) -> Vec<f64> {
    let n = ((secs / len).ceil() as u64).max(1);
    let max = u64::from(max.max(1));
    let picked: Vec<u64> = if n <= max {
        (0..n).collect()
    } else {
        (0..max).map(|i| i * n / max).collect()
    };
    picked.into_iter().map(|i| i as f64 * len).collect()
}

pub fn part(start: f64, end: f64, media: ContentMedia) -> ContentPart {
    ContentPart {
        start: Some(start),
        end: Some(end),
        media,
    }
}

pub fn ffmpeg(f: &File, start: f64, len: f64, out: &[&str]) -> Result<Vec<u8>, String> {
    let t = |s: &str| CommandArg::Text(s.to_owned());
    let mut args = vec![
        t("-hide_banner"),
        t("-v"),
        t("error"),
        t("-nostdin"),
        t("-ss"),
        t(&format!("{start:.3}")),
        t("-t"),
        t(&format!("{len:.3}")),
        t("-i"),
        CommandArg::File(f.clone()),
    ];
    args.extend(out.iter().map(|s| t(s)));
    let r = host::run_command("ffmpeg", &args, Some(TIMEOUT))?;
    if r.code != Some(0) {
        return Err(format!(
            "FFmpeg での取り出しに失敗しました：{}",
            r.stderr.trim()
        ));
    }
    Ok(r.stdout)
}

/// FFmpeg で切り出す max-audio-secs ごとの 16 kHz・モノラルの WAV。symphonia で読めない形式に使う。
/// 長さがわからなければ、頭から空になるまで読む。
pub fn audio(f: &File, secs: Option<f64>, budget: &ContentBudget) -> Vec<ContentPart> {
    let len = budget.max_audio_secs.max(1.0);
    let limit = secs.unwrap_or(len * f64::from(budget.max_parts));
    let mut out = Vec::new();
    for s in starts(limit, len, budget.max_parts) {
        let wav = ffmpeg(
            f,
            s,
            len,
            &["-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "-"],
        );
        match wav {
            Ok(w) if w.len() > 44 => {
                out.push(part(s, (s + len).min(limit), ContentMedia::Audio(w)));
            }
            Ok(_) => break,
            Err(e) => {
                host::log(&e);
                break;
            }
        }
    }
    out
}
