/*
 * テンポの見積もり。音の立ち上がりの強さを 200 Hz ほどの列にし、その自己相関がいちばん強い間隔を拍とみなす。
 * 低い音（キックなど）とそれ以外で立ち上がりを分けて足し、120 BPM の近くを少し優先して、倍や半分の取り違えを減らす。
 */

const ENV_RATE: f64 = 200.0;
const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 200.0;
const MIN_SECS: f64 = 3.0;
/// 拍があるとみなす、いちばん強い間隔の強さ（平均との比）。
const CLEAR: f64 = 1.3;

pub fn estimate(x: &[f32], rate: f64) -> Option<f64> {
    let hop = (rate / ENV_RATE).round().max(1.0) as usize;
    let env = rate / hop as f64;
    if (x.len() as f64) < MIN_SECS * rate {
        return None;
    }
    let onset = onsets(x, rate, hop);
    let lag_of = |bpm: f64| 60.0 * env / bpm;
    let (lo, hi) = (
        lag_of(MAX_BPM).floor() as usize,
        lag_of(MIN_BPM).ceil() as usize,
    );
    if onset.len() <= hi * 2 {
        return None;
    }
    let ac = |l: usize| {
        let n = onset.len() - l;
        onset[..n]
            .iter()
            .zip(&onset[l..])
            .map(|(a, b)| a * b)
            .sum::<f64>()
            / n as f64
    };
    let raw: Vec<f64> = (0..=hi * 2)
        .map(|l| if l < lo { 0.0 } else { ac(l) })
        .collect();
    let plain: Vec<f64> = (lo..=hi).map(|l| raw[l] + 0.5 * raw[l * 2]).collect();
    let score: Vec<f64> = plain
        .iter()
        .enumerate()
        .map(|(k, v)| {
            let bpm = 60.0 * env / (lo + k) as f64;
            v * (-0.5 * (bpm / 120.0).log2().powi(2)).exp()
        })
        .collect();
    let (k, &best) = score.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1))?;
    // 拍のない音では、どの間隔でも同じくらいになる
    let mean = plain.iter().sum::<f64>() / plain.len() as f64;
    // 範囲の端がいちばん強いときは、範囲の外に本当の山がある
    if plain[k] <= mean * CLEAR || k == 0 || k + 1 == score.len() {
        return None;
    }
    // 両隣と放物線を当てて、間隔を細かくする
    let shift = match (k.checked_sub(1).map(|i| score[i]), score.get(k + 1)) {
        (Some(a), Some(&c)) if a + c - 2.0 * best < 0.0 => 0.5 * (a - c) / (a + c - 2.0 * best),
        _ => 0.0,
    };
    Some(60.0 * env / ((lo + k) as f64 + shift))
}

fn onsets(x: &[f32], rate: f64, hop: usize) -> Vec<f64> {
    let a = (-2.0 * std::f64::consts::PI * 200.0 / rate).exp();
    let mut lp = 0.0;
    let (mut low, mut high) = (Vec::new(), Vec::new());
    for chunk in x.chunks_exact(hop) {
        let (mut el, mut eh) = (0.0, 0.0);
        for &s in chunk {
            let s = f64::from(s);
            lp = (1.0 - a) * s + a * lp;
            el += lp * lp;
            eh += (s - lp) * (s - lp);
        }
        low.push((1e-9 + el / hop as f64).ln());
        high.push((1e-9 + eh / hop as f64).ln());
    }
    let flux = |e: &[f64]| {
        let d: Vec<f64> = e.windows(2).map(|w| (w[1] - w[0]).max(0.0)).collect();
        let m = d.iter().sum::<f64>() / d.len().max(1) as f64;
        d.into_iter()
            .map(move |v| if m > 0.0 { v / m } else { 0.0 })
    };
    let sum: Vec<f64> = flux(&low).zip(flux(&high)).map(|(a, b)| a + b).collect();
    // ゆっくりした音量の変化を除く
    let half = (ENV_RATE * 0.25) as usize;
    let mut out = Vec::with_capacity(sum.len());
    let mut acc: f64 = sum[..half.min(sum.len())].iter().sum();
    for i in 0..sum.len() {
        if i + half < sum.len() {
            acc += sum[i + half];
        }
        if i > half {
            acc -= sum[i - half - 1];
        }
        let n = (i + half + 1).min(sum.len()) - i.saturating_sub(half);
        out.push((sum[i] - acc / n as f64).max(0.0));
    }
    // 拍の間隔は列の刻みの整数倍とは限らないので、立ち上がりを前後になだらかに広げる
    let k = [0.25, 0.5, 1.0, 0.5, 0.25];
    (0..out.len())
        .map(|i| {
            k.iter()
                .enumerate()
                .filter_map(|(j, w)| out.get((i + j).checked_sub(2)?).map(|v| v * w))
                .sum()
        })
        .collect()
}
