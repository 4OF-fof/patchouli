use crate::File;
use crate::patchouli::plugin::host::{self, CommandArg};

pub struct Probe {
    pub size: Option<(u32, u32)>,
    pub secs: Option<f64>,
}

/// FFmpeg が読んだ入力の情報から、映像の大きさと長さを拾う。FFmpeg がなければ none。
pub fn probe(f: &File) -> Option<Probe> {
    if !host::command_available("ffmpeg") {
        return None;
    }
    let t = |s: &str| CommandArg::Text(s.to_owned());
    let args = vec![
        t("-hide_banner"),
        t("-nostdin"),
        t("-i"),
        CommandArg::File(f.clone()),
    ];
    // 出力を書かないので終わりの番号は 0 でないが、入力の情報は stderr に出る
    let log = host::run_command("ffmpeg", &args, None).ok()?.stderr;
    Some(Probe {
        size: size(&log),
        secs: duration(&log),
    })
}

/// 「Duration: 00:03:45.12」を秒にする。
fn duration(log: &str) -> Option<f64> {
    let s = log.split("Duration: ").nth(1)?.split(',').next()?;
    s.trim()
        .split(':')
        .try_fold(0.0, |acc, p| Some(acc * 60.0 + p.parse::<f64>().ok()?))
}

/// 最初の映像（ジャケットの絵は除く）の「1920x1080」。縦にして撮ったものは入れ替える。
fn size(log: &str) -> Option<(u32, u32)> {
    let line = log
        .lines()
        .find(|l| l.contains("Video:") && !l.contains("attached pic"))?;
    let (w, h) = line
        .split([' ', ','])
        .filter_map(|w| w.split_once('x'))
        .find_map(|(a, b)| Some((a.parse::<u32>().ok()?, b.parse::<u32>().ok()?)))?;
    let turned = log.contains("rotation of 90") || log.contains("rotation of -90");
    Some(if turned { (h, w) } else { (w, h) })
}
