use std::io::{self, Read, Seek, SeekFrom};

use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::units::Time;

use crate::excerpt::{part, starts};
use crate::patchouli::plugin::host;
use crate::patchouli::plugin::types::File;
use crate::patchouli::plugin::types::{ExcerptBudget, ExcerptMedia, ExcerptPart};

/// ホストの read で読む MediaSource。
/// MP4 は映像と音声のパケットが交互に並び、パケットごとにシークされるので、
/// 読んだ塊を持っておき、その中へのシークでは読み直さない。
struct Source {
    f: File,
    pos: u64,
    chunk: Vec<u8>,
    at: u64,
}

const CHUNK: u32 = 1 << 20;

impl Read for Source {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.f.size || buf.is_empty() {
            return Ok(0);
        }
        let end = self.at + self.chunk.len() as u64;
        if self.pos < self.at || self.pos >= end {
            self.chunk = host::read(&self.f, self.pos, CHUNK).map_err(io::Error::other)?;
            self.at = self.pos;
            if self.chunk.is_empty() {
                return Ok(0);
            }
        }
        let from = (self.pos - self.at) as usize;
        let n = buf.len().min(self.chunk.len() - from);
        buf[..n].copy_from_slice(&self.chunk[from..from + n]);
        self.pos += n as u64;
        Ok(n)
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
        chunk: Vec::new(),
        at: 0,
    };
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    symphonia::default::get_probe()
        .probe(&hint, mss, Default::default(), Default::default())
        .map_err(|e| e.to_string())
}

const RATE: f64 = 16_000.0;

/// rate のモノラルを、区切りごとの平均で 16 kHz に落とした WAV にする。
fn wav(mono: &[f32], rate: f64) -> Vec<u8> {
    let step = rate / RATE;
    let n = (mono.len() as f64 / step) as usize;
    let mut out = Vec::with_capacity(44 + n * 2);
    let data = (n * 2) as u32;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(RATE as u32).to_le_bytes());
    out.extend_from_slice(&(RATE as u32 * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for k in 0..n {
        let (a, b) = ((k as f64 * step) as usize, ((k + 1) as f64 * step) as usize);
        let s = &mono[a..b.clamp(a + 1, mono.len())];
        let v = s.iter().sum::<f32>() / s.len() as f32;
        out.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

/// max-audio-secs ごとの 16 kHz・モノラルの WAV。区間を全部読むときは頭から続けてデコードし、
/// 間引くときは区間ごとに 1 回だけシークする（MP4 では、映像のパケットを読み飛ばすあいだにシークし直すと進まなくなる）。
pub fn audio(ext: &str, f: &File, budget: &ExcerptBudget) -> Result<Vec<ExcerptPart>, String> {
    let mut format = reader(ext, f)?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or("音声がありません")?;
    let id = track.id;
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
    let len = budget.max_audio_secs.max(1.0);
    let known = track
        .time_base
        .zip(track.duration)
        .and_then(|(b, d)| b.calc_duration(d))
        .map(|t| t.as_secs_f64())
        .or(track.num_frames.map(|n| n as f64 / rate));
    let secs = known.unwrap_or(len * f64::from(budget.max_audio_parts));
    let picked = starts(secs, len, budget.max_audio_parts);
    let seek = (picked.len() as f64) * len < secs;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &Default::default())
        .map_err(|e| e.to_string())?;
    let per = (len * rate) as usize;
    let (mut out, mut mono, mut buf) = (Vec::new(), Vec::<f32>::new(), Vec::<f32>::new());
    let mut k = 0;
    let mut sought = None;
    while k < picked.len() {
        let at = picked[k];
        if seek && sought != Some(k) {
            sought = Some(k);
            let time = Time::try_from_secs_f64(at).ok_or("シークする位置が不正です")?;
            let to = SeekTo::Time {
                time,
                track_id: Some(id),
            };
            if format.seek(SeekMode::Coarse, to).is_err() {
                break;
            }
            decoder.reset();
        }
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) | Err(Error::IoError(_)) => break,
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id != id {
            continue;
        }
        let Ok(b) = decoder.decode(&packet) else {
            continue;
        };
        let ch = b.spec().channels().count().max(1);
        b.copy_to_vec_interleaved(&mut buf);
        mono.extend(
            buf.chunks_exact(ch)
                .map(|fr| fr.iter().sum::<f32>() / ch as f32),
        );
        while mono.len() >= per && k < picked.len() {
            let rest = mono.split_off(per);
            out.push(part(
                picked[k],
                picked[k] + len,
                ExcerptMedia::Audio(wav(&mono, rate)),
            ));
            mono = if seek { Vec::new() } else { rest };
            k += 1;
        }
    }
    // 最後の区間は短くても、1 秒あれば読む
    if k < picked.len() && mono.len() as f64 >= rate {
        let end = picked[k] + mono.len() as f64 / rate;
        out.push(part(picked[k], end, ExcerptMedia::Audio(wav(&mono, rate))));
    }
    Ok(out)
}
