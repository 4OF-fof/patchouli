use std::cell::RefCell;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::rc::Rc;

use ruzstd::decoding::errors::{FrameDecoderError, ReadFrameHeaderError};
use ruzstd::decoding::{FrameDecoder, StreamingDecoder};

use crate::CHUNK;
use crate::patchouli::plugin::host;
use crate::patchouli::plugin::types::File;

/// host の read で読むファイル。
pub struct Source {
    file: File,
    pos: u64,
    at: u64,
    buf: Vec<u8>,
}

impl Source {
    pub fn new(file: &File) -> Source {
        Source {
            file: file.clone(),
            pos: 0,
            at: 0,
            buf: Vec::new(),
        }
    }
}

impl Read for Source {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.pos < self.at || self.pos >= self.at + self.buf.len() as u64 {
            self.buf = host::read(&self.file, self.pos, CHUNK as u32).map_err(io::Error::other)?;
            self.at = self.pos;
        }
        let from = (self.pos - self.at) as usize;
        let n = out.len().min(self.buf.len() - from);
        out[..n].copy_from_slice(&self.buf[from..from + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for Source {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let pos = match to {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::End(d) => self.file.size.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        self.pos = pos.ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
        Ok(self.pos)
    }
}

/// host の write で書くファイル。
pub struct Output(pub File);

impl Write for Output {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        host::write(&self.0, data).map_err(io::Error::other)?;
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
struct Shared(Rc<RefCell<Source>>);

impl Read for Shared {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        self.0.borrow_mut().read(out)
    }
}

/// zstd の展開。並列に圧縮したものは、読み飛ばす枠と本体の枠がいくつも続く。
pub struct Zstd {
    source: Shared,
    frame: Option<StreamingDecoder<Shared, FrameDecoder>>,
}

impl Zstd {
    pub fn new(file: &File) -> Zstd {
        Zstd {
            source: Shared(Rc::new(RefCell::new(Source::new(file)))),
            frame: None,
        }
    }

    fn at_end(&self) -> bool {
        let s = self.source.0.borrow();
        s.pos >= s.file.size
    }
}

impl Read for Zstd {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        loop {
            if let Some(frame) = &mut self.frame {
                let n = frame.read(out)?;
                if n > 0 || out.is_empty() {
                    return Ok(n);
                }
                self.frame = None;
            }
            if self.at_end() {
                return Ok(0);
            }
            match StreamingDecoder::new(self.source.clone()) {
                Ok(frame) => self.frame = Some(frame),
                Err(FrameDecoderError::ReadFrameHeaderError(ReadFrameHeaderError::SkipFrame {
                    length,
                    ..
                })) => {
                    self.source
                        .0
                        .borrow_mut()
                        .seek(SeekFrom::Current(i64::from(length)))?;
                }
                Err(e) => return Err(io::Error::other(e.to_string())),
            }
        }
    }
}
