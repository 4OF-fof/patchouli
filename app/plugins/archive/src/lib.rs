//! アーカイブの中のファイルの一覧と取り出し。形式は拡張子より先に、先頭のバイト列で決める。

wit_bindgen::generate!({
    inline: "
        package local:archive;

        world archive {
            include patchouli:plugin/archive-role@0.13.1;
        }
    ",
    path: "../sdk/wit",
    world: "local:archive/archive",
    generate_all,
});

mod source;

use std::collections::{HashMap, HashSet};
use std::fmt::Display;
use std::io::{self, BufWriter, Cursor, Read};

use exports::patchouli::plugin as role;
use patchouli::plugin::host;
use patchouli::plugin::types::{ArchiveEntry, ArchiveOutput, File};
use rars::{ArchiveReadOptions, ExtractionDecision};
use sevenz_rust2::{ArchiveReader, EntryDecision, Password};
use source::{Output, Source, Zstd};
use tar::EntryType;
use zip::ZipArchive;

const CHUNK: usize = 1 << 20;
const HEAD: u32 = 512;
const NEED_PASSWORD: &str = "パスワード付きのアーカイブは開けません";

#[derive(Clone, Copy)]
enum Stream {
    Gz,
    Bz2,
    Xz,
    Zst,
}

#[derive(Clone, Copy)]
enum Kind {
    Zip,
    SevenZ,
    Rar,
    Tar,
    Stream(Stream),
}

fn is_tar(head: &[u8]) -> bool {
    head.get(257..262) == Some(b"ustar")
}

fn tar_name(format: &str) -> bool {
    matches!(format, "tar" | "tgz" | "tbz" | "tbz2" | "txz" | "tzst")
}

fn kind_of(format: &str, f: &File) -> Result<Kind, String> {
    let head = host::read(f, 0, HEAD)?;
    Ok(match &head {
        h if h.starts_with(b"PK\x03\x04") || h.starts_with(b"PK\x05\x06") => Kind::Zip,
        h if h.starts_with(b"7z\xBC\xAF\x27\x1C") => Kind::SevenZ,
        h if h.starts_with(b"Rar!\x1A\x07") || h.starts_with(b"RE~^") => Kind::Rar,
        h if h.starts_with(b"\x1F\x8B") => Kind::Stream(Stream::Gz),
        h if h.starts_with(b"BZh") => Kind::Stream(Stream::Bz2),
        h if h.starts_with(b"\xFD7zXZ\x00") => Kind::Stream(Stream::Xz),
        h if h.starts_with(b"\x28\xB5\x2F\xFD") || h.starts_with(b"\x50\x2A\x4D\x18") => {
            Kind::Stream(Stream::Zst)
        }
        h if is_tar(h) => Kind::Tar,
        _ => match format {
            "zip" => Kind::Zip,
            "7z" => Kind::SevenZ,
            "rar" => Kind::Rar,
            f if tar_name(f) => Kind::Tar,
            _ => return Err("対応していない形式か、ファイルが破損しています".into()),
        },
    })
}

fn text(e: impl Display) -> String {
    e.to_string()
}

fn seven_error(e: sevenz_rust2::Error) -> String {
    match e {
        sevenz_rust2::Error::PasswordRequired => NEED_PASSWORD.into(),
        sevenz_rust2::Error::UnsupportedCompressionMethod(m) if m.contains("AES") => {
            NEED_PASSWORD.into()
        }
        e => e.to_string(),
    }
}

fn rar_error(e: rars::Error) -> String {
    match e {
        rars::Error::NeedPassword | rars::Error::FeatureDisabled { .. } => NEED_PASSWORD.into(),
        e => e.to_string(),
    }
}

/// 名前のバイト列を文字列にする。UTF-8 でなければ Shift_JIS として読む。
fn name_of(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_owned(),
        Err(_) => encoding_rs::SHIFT_JIS.decode(raw).0.into_owned(),
    }
}

/// 区切りを / に揃える。アーカイブの外を指す名前は None。
fn clean(name: &str) -> Option<String> {
    let parts: Vec<&str> = name
        .split(['/', '\\'])
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    (!parts.is_empty() && !parts.contains(&"..")).then(|| parts.join("/"))
}

/// 同じ名前が 2 回出てきたら、最初のものを使う。
#[derive(Default)]
struct Listing {
    seen: HashSet<String>,
    out: Vec<ArchiveEntry>,
}

impl Listing {
    fn add(&mut self, name: &str, size: u64, encrypted: bool) {
        let Some(path) = clean(name) else { return };
        if self.seen.insert(path.clone()) {
            self.out.push(ArchiveEntry {
                path,
                size,
                encrypted,
            });
        }
    }
}

struct Wanted(HashMap<String, File>);

impl Wanted {
    fn new(outputs: Vec<ArchiveOutput>) -> Wanted {
        Wanted(outputs.into_iter().map(|o| (o.path, o.file)).collect())
    }

    fn take(&mut self, name: &str) -> Option<File> {
        self.0.remove(&clean(name)?)
    }

    fn done(&self) -> bool {
        self.0.is_empty()
    }
}

fn copy(r: &mut dyn Read, out: &File) -> Result<(), String> {
    let mut buf = vec![0; CHUNK];
    loop {
        let mut n = 0;
        while n < buf.len() {
            match r.read(&mut buf[n..]) {
                Ok(0) => break,
                Ok(k) => n += k,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        if n > 0 {
            host::write(out, &buf[..n])?;
        }
        if n < buf.len() {
            return Ok(());
        }
    }
}

fn zip_entries(f: &File, list: &mut Listing) -> Result<(), String> {
    let mut a = ZipArchive::new(Source::new(f)).map_err(text)?;
    for i in 0..a.len() {
        let e = a.by_index_raw(i).map_err(text)?;
        if !e.is_dir() && !e.is_symlink() {
            list.add(&name_of(e.name_raw()), e.size(), e.encrypted());
        }
    }
    Ok(())
}

fn zip_extract(f: &File, wanted: &mut Wanted) -> Result<(), String> {
    let mut a = ZipArchive::new(Source::new(f)).map_err(text)?;
    for i in 0..a.len() {
        if wanted.done() {
            break;
        }
        let name = name_of(a.by_index_raw(i).map_err(text)?.name_raw());
        if let Some(out) = wanted.take(&name) {
            copy(&mut a.by_index(i).map_err(text)?, &out)?;
        }
    }
    Ok(())
}

fn seven_entries(f: &File, list: &mut Listing) -> Result<(), String> {
    let r = ArchiveReader::new(Source::new(f), Password::empty()).map_err(seven_error)?;
    let a = r.archive();
    for (i, e) in a.files.iter().enumerate() {
        if !e.is_directory && !e.is_anti_item {
            list.add(&e.name, e.size, a.is_file_encrypted(i));
        }
    }
    Ok(())
}

fn seven_extract(f: &File, wanted: &mut Wanted) -> Result<(), String> {
    let mut r = ArchiveReader::new(Source::new(f), Password::empty()).map_err(seven_error)?;
    let a = r.archive();
    let mut left = vec![0usize; a.blocks.len()];
    let mut block_of = HashMap::new();
    for (e, block) in a.files.iter().zip(&a.stream_map.file_block_index) {
        let Some(block) = *block else { continue };
        block_of.insert(e.name.clone(), block);
        if clean(&e.name).is_some_and(|p| wanted.0.contains_key(&p)) {
            left[block] += 1;
        }
    }
    let mut failed = None;
    r.for_each_entries_with_decision(|e, data| {
        let block = block_of.get(&e.name).copied();
        if let Some(out) = wanted.take(&e.name) {
            if let Err(message) = copy(data, &out) {
                failed = Some(message);
                return Ok(EntryDecision::Stop);
            }
            if let Some(b) = block {
                left[b] -= 1;
            }
        }
        Ok(if wanted.done() {
            EntryDecision::Stop
        } else if block.is_some_and(|b| left[b] == 0) {
            EntryDecision::SkipBlock
        } else {
            EntryDecision::Continue
        })
    })
    .map_err(seven_error)?;
    failed.map_or(Ok(()), Err)
}

fn rar_entries(f: &File, list: &mut Listing) -> Result<(), String> {
    let a = rars::ArchiveReader::read_reader(Source::new(f)).map_err(rar_error)?;
    for m in a.members() {
        let meta = &m.meta;
        if !meta.is_directory
            && !meta.is_redirection
            && !meta.is_split_before
            && !meta.is_split_after
        {
            list.add(&name_of(&meta.name), meta.unpacked_size, meta.is_encrypted);
        }
    }
    Ok(())
}

fn rar_extract(f: &File, wanted: &mut Wanted) -> Result<(), String> {
    let a = rars::ArchiveReader::read_reader(Source::new(f)).map_err(rar_error)?;
    // ソリッドのアーカイブは前のファイルの続きとして圧縮してあるので、読み飛ばせない
    let solid = matches!(a, rars::Archive::Rar13(_)) || a.members().any(|m| m.is_solid());
    a.extract_with_control(ArchiveReadOptions::new(), |m| {
        Ok(if wanted.done() {
            ExtractionDecision::Stop
        } else if m.meta.is_directory || m.meta.is_redirection {
            ExtractionDecision::Skip
        } else if let Some(out) = wanted.take(&name_of(&m.meta.name)) {
            ExtractionDecision::Extract(Box::new(BufWriter::with_capacity(CHUNK, Output(out))))
        } else if solid {
            ExtractionDecision::Extract(Box::new(io::sink()))
        } else {
            ExtractionDecision::Skip
        })
    })
    .map_err(rar_error)?;
    Ok(())
}

fn tar_file(ty: EntryType) -> bool {
    matches!(
        ty,
        EntryType::Regular | EntryType::Continuous | EntryType::GNUSparse
    )
}

fn tar_entries(r: impl Read, list: &mut Listing) -> Result<(), String> {
    let mut a = tar::Archive::new(r);
    for e in a.entries().map_err(text)? {
        let e = e.map_err(text)?;
        if tar_file(e.header().entry_type()) {
            list.add(&name_of(&e.path_bytes()), e.size(), false);
        }
    }
    Ok(())
}

fn tar_extract(r: impl Read, wanted: &mut Wanted) -> Result<(), String> {
    let mut a = tar::Archive::new(r);
    for e in a.entries().map_err(text)? {
        if wanted.done() {
            break;
        }
        let mut e = e.map_err(text)?;
        if !tar_file(e.header().entry_type()) {
            continue;
        }
        if let Some(out) = wanted.take(&name_of(&e.path_bytes())) {
            copy(&mut e, &out)?;
        }
    }
    Ok(())
}

fn decoder(stream: Stream, f: &File) -> Box<dyn Read> {
    let s = Source::new(f);
    match stream {
        Stream::Gz => Box::new(flate2::read::MultiGzDecoder::new(s)),
        Stream::Bz2 => Box::new(bzip2::read::MultiBzDecoder::new(s)),
        Stream::Xz => Box::new(lzma_rust2::XzReader::new(s, true)),
        Stream::Zst => Box::new(Zstd::new(f)),
    }
}

/// 展開した先頭と、その続きを読むもの。tar かどうかを先頭で決める。
fn opened(format: &str, stream: Stream, f: &File) -> Result<(bool, impl Read), String> {
    let mut r = decoder(stream, f);
    let mut head = Vec::new();
    (&mut r)
        .take(u64::from(HEAD))
        .read_to_end(&mut head)
        .map_err(text)?;
    Ok((
        tar_name(format) || is_tar(&head),
        Cursor::new(head).chain(r),
    ))
}

fn stream_entries(
    format: &str,
    stream: Stream,
    f: &File,
    list: &mut Listing,
) -> Result<(), String> {
    let (tar, mut r) = opened(format, stream, f)?;
    if tar {
        return tar_entries(r, list);
    }
    let size = io::copy(&mut r, &mut io::sink()).map_err(text)?;
    list.out.push(ArchiveEntry {
        path: String::new(),
        size,
        encrypted: false,
    });
    Ok(())
}

fn stream_extract(
    format: &str,
    stream: Stream,
    f: &File,
    wanted: &mut Wanted,
) -> Result<(), String> {
    let (tar, mut r) = opened(format, stream, f)?;
    if tar {
        return tar_extract(r, wanted);
    }
    match wanted.0.remove("") {
        Some(out) => copy(&mut r, &out),
        None => Ok(()),
    }
}

struct Plugin;

impl role::archive::Guest for Plugin {
    fn entries(format: String, f: File) -> Result<Vec<ArchiveEntry>, String> {
        let mut list = Listing::default();
        match kind_of(&format, &f)? {
            Kind::Zip => zip_entries(&f, &mut list)?,
            Kind::SevenZ => seven_entries(&f, &mut list)?,
            Kind::Rar => rar_entries(&f, &mut list)?,
            Kind::Tar => tar_entries(Source::new(&f), &mut list)?,
            Kind::Stream(s) => stream_entries(&format, s, &f, &mut list)?,
        }
        Ok(list.out)
    }

    fn extract(format: String, f: File, outputs: Vec<ArchiveOutput>) -> Result<(), String> {
        let mut wanted = Wanted::new(outputs);
        match kind_of(&format, &f)? {
            Kind::Zip => zip_extract(&f, &mut wanted),
            Kind::SevenZ => seven_extract(&f, &mut wanted),
            Kind::Rar => rar_extract(&f, &mut wanted),
            Kind::Tar => tar_extract(Source::new(&f), &mut wanted),
            Kind::Stream(s) => stream_extract(&format, s, &f, &mut wanted),
        }
    }
}

export!(Plugin);
