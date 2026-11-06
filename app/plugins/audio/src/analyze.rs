use symphonia::core::errors::Error;
use symphonia::core::formats::TrackType;
use symphonia::core::units::Duration;

use crate::bpm;
use crate::patchouli::plugin::types::File;
use crate::pcm::reader;

/// テンポを測る範囲（秒）。頭は前奏のことが多いので、長い曲では少し先から測る。
const SKIP: f64 = 30.0;
const SPAN: f64 = 90.0;

pub struct Analysis {
    pub secs: f64,
    pub bpm: Option<f64>,
    pub kbps: Option<f64>,
}

pub fn analyze(ext: &str, f: &File) -> Result<Analysis, String> {
    let mut format = reader(ext, f)?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or("音声がありません")?;
    let id = track.id;
    let base = track.time_base;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or("音声の形式を取得できません")?
        .clone();
    let rate = f64::from(
        params
            .sample_rate
            .ok_or("サンプリング周波数を取得できません")?,
    );
    let known = base
        .zip(track.duration)
        .and_then(|(b, d)| b.calc_duration(d))
        .map(|t| t.as_secs_f64())
        .or(track.num_frames.map(|n| n as f64 / rate));
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &Default::default())
        .map_err(|e| e.to_string())?;

    let skip = if known.is_some_and(|s| s > SKIP + SPAN) {
        SKIP
    } else {
        0.0
    };
    let (from, to) = ((skip * rate) as usize, ((skip + SPAN) * rate) as usize);
    let (mut at, mut mono, mut buf) = (0usize, Vec::new(), Vec::<f32>::new());
    let (mut dur, mut bytes) = (0u64, 0u64);
    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(Error::IoError(_) | Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id != id {
            continue;
        }
        dur += packet.dur.get();
        bytes += packet.data.len() as u64;
        if at >= to {
            // 長さがわからなければ、最後まで数える
            if known.is_some() {
                break;
            }
            continue;
        }
        let Ok(b) = decoder.decode(&packet) else {
            continue;
        };
        let ch = b.spec().channels().count().max(1);
        b.copy_to_vec_interleaved(&mut buf);
        for frame in buf.chunks_exact(ch) {
            if (from..to).contains(&at) {
                mono.push(frame.iter().sum::<f32>() / ch as f32);
            }
            at += 1;
        }
    }
    let counted = base
        .and_then(|b| b.calc_duration(Duration::from(dur)))
        .map_or(dur as f64 / rate, |t| t.as_secs_f64());
    // ジャケットなどを含めないよう、ファイルの大きさではなく読んだ音声の量から平均を出す
    let kbps = (counted > 0.0).then(|| bytes as f64 * 8.0 / counted / 1000.0);
    Ok(Analysis {
        secs: known.unwrap_or(counted),
        bpm: bpm::estimate(&mono, rate),
        kbps,
    })
}
