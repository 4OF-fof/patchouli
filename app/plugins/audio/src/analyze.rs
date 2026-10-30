use std::io::{self, Read, Seek, SeekFrom};

use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatReader, TrackType};
use symphonia::core::formats::probe::Hint;
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::units::Duration;

use crate::File;
use crate::bpm;
use crate::patchouli::plugin::host;

/// テンポを測る範囲（秒）。頭は前奏のことが多いので、長い曲では少し先から測る。
const SKIP: f64 = 30.0;
const SPAN: f64 = 90.0;

pub struct Analysis {
    pub secs: f64,
    pub bpm: Option<f64>,
}

/// ホストの read で読む MediaSource。
struct Source {
    f: File,
    pos: u64,
}

impl Read for Source {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.f.size || buf.is_empty() {
            return Ok(0);
        }
        let len = buf.len().min(1 << 20) as u32;
        let chunk = host::read(&self.f, self.pos, len).map_err(io::Error::other)?;
        buf[..chunk.len()].copy_from_slice(&chunk);
        self.pos += chunk.len() as u64;
        Ok(chunk.len())
    }
}

impl Seek for Source {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let pos = match to {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::End(d) => self.f.size.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        self.pos = pos.ok_or_else(|| io::Error::other("ファイルの外を指しています"))?;
        Ok(self.pos)
    }
}

impl MediaSource for Source {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.f.size)
    }
}

pub fn reader(ext: &str, f: &File) -> Result<Box<dyn FormatReader>, String> {
    let src = Source {
        f: f.clone(),
        pos: 0,
    };
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    symphonia::default::get_probe()
        .probe(&hint, mss, Default::default(), Default::default())
        .map_err(|e| e.to_string())
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
        .ok_or("音声の形式がわかりません")?
        .clone();
    let rate = f64::from(
        params
            .sample_rate
            .ok_or("サンプリング周波数がわかりません")?,
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
    let mut dur = 0u64;
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
    Ok(Analysis {
        secs: known.unwrap_or(counted),
        bpm: bpm::estimate(&mono, rate),
    })
}
