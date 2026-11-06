//! 区間と文章のベクトル。サムネイルと同じキャッシュ（thumbs/<ライブラリ>/embed）に置き、同期しない。
//! sig が変わった項目だけ作り直す。モデルが変わったら全部捨てる。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, params};

use crate::embed::MODEL;

pub struct Part {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub kind: &'static str,
    pub vec: Vec<f32>,
}

pub struct Store(Connection);

/// 書き換えるたびに増やし、読み込んだ索引を作り直す目安にする。
static GEN: AtomicU64 = AtomicU64::new(0);

fn changed() {
    GEN.fetch_add(1, Ordering::Relaxed);
}

pub fn path_for(thumbs: &Path) -> PathBuf {
    thumbs.join("embed").join("vectors.sqlite")
}

fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn kind_of(s: &str) -> &'static str {
    match s {
        "images" => "images",
        "audio" => "audio",
        _ => "text",
    }
}

impl Store {
    pub fn open(path: &Path) -> Result<Store, String> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let c = Connection::open(path).map_err(|e| e.to_string())?;
        c.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, sig TEXT NOT NULL, vec BLOB);
             CREATE TABLE IF NOT EXISTS parts (id TEXT NOT NULL, k INTEGER NOT NULL, start REAL, end REAL, kind TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (id, k));
             CREATE TABLE IF NOT EXISTS text (id TEXT PRIMARY KEY, sig TEXT NOT NULL, vec BLOB NOT NULL);
             CREATE TABLE IF NOT EXISTS words (key TEXT PRIMARY KEY, vec BLOB NOT NULL);",
        )
        .map_err(|e| e.to_string())?;
        let model: Option<String> = c
            .query_row("SELECT value FROM meta WHERE key = 'model'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        if model.as_deref() != Some(MODEL) {
            c.execute_batch(
                "DELETE FROM content; DELETE FROM parts; DELETE FROM text; DELETE FROM words;",
            )
            .map_err(|e| e.to_string())?;
            c.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('model', ?1)",
                [MODEL],
            )
            .map_err(|e| e.to_string())?;
            changed();
        }
        Ok(Store(c))
    }

    fn sigs(&self, table: &str) -> HashMap<String, String> {
        let Ok(mut st) = self.0.prepare(&format!("SELECT id, sig FROM {table}")) else {
            return HashMap::new();
        };
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    pub fn content_sigs(&self) -> HashMap<String, String> {
        self.sigs("content")
    }

    pub fn text_sigs(&self) -> HashMap<String, String> {
        self.sigs("text")
    }

    /// whole は区間の平均。区間もサムネイルもなければ None。
    pub fn put_content(
        &mut self,
        id: &str,
        sig: &str,
        whole: Option<&[f32]>,
        parts: &[Part],
    ) -> Result<(), String> {
        let tx = self.0.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM parts WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        for (k, p) in parts.iter().enumerate() {
            tx.execute(
                "INSERT INTO parts (id, k, start, end, kind, vec) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, k as i64, p.start, p.end, p.kind, to_blob(&p.vec)],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO content (id, sig, vec) VALUES (?1, ?2, ?3)",
            params![id, sig, whole.map(to_blob)],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        changed();
        Ok(())
    }

    /// 語やタグ名のベクトル。key は、渡し方と語をつないだもの。なければ make で作って残す。
    pub fn word(
        &self,
        key: &str,
        make: impl FnOnce() -> Result<Vec<f32>, String>,
    ) -> Result<Vec<f32>, String> {
        let got: Option<Vec<u8>> = self
            .0
            .query_row("SELECT vec FROM words WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(b) = got {
            return Ok(to_vec(&b));
        }
        let v = make()?;
        self.0
            .execute(
                "INSERT OR REPLACE INTO words (key, vec) VALUES (?1, ?2)",
                params![key, to_blob(&v)],
            )
            .map_err(|e| e.to_string())?;
        Ok(v)
    }

    pub fn put_text(&self, id: &str, sig: &str, vec: &[f32]) -> Result<(), String> {
        self.0
            .execute(
                "INSERT OR REPLACE INTO text (id, sig, vec) VALUES (?1, ?2, ?3)",
                params![id, sig, to_blob(vec)],
            )
            .map_err(|e| e.to_string())?;
        changed();
        Ok(())
    }

    /// keep にない項目の行を消す。
    pub fn retain(&mut self, keep: &HashSet<String>) -> Result<usize, String> {
        let gone: Vec<String> = self
            .content_sigs()
            .into_keys()
            .chain(self.text_sigs().into_keys())
            .filter(|id| !keep.contains(id))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let tx = self.0.transaction().map_err(|e| e.to_string())?;
        for id in &gone {
            for table in ["content", "parts", "text"] {
                tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        if !gone.is_empty() {
            changed();
        }
        Ok(gone.len())
    }

    fn vecs(&self, sql: &str) -> HashMap<String, Vec<f32>> {
        let Ok(mut st) = self.0.prepare(sql) else {
            return HashMap::new();
        };
        st.query_map([], |r| Ok((r.get(0)?, to_vec(&r.get::<_, Vec<u8>>(1)?))))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    fn parts(&self) -> HashMap<String, Vec<Part>> {
        let mut out: HashMap<String, Vec<Part>> = HashMap::new();
        let Ok(mut st) = self
            .0
            .prepare("SELECT id, start, end, kind, vec FROM parts ORDER BY id, k")
        else {
            return out;
        };
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Part {
                    start: r.get(1)?,
                    end: r.get(2)?,
                    kind: kind_of(&r.get::<_, String>(3)?),
                    vec: to_vec(&r.get::<_, Vec<u8>>(4)?),
                },
            ))
        });
        if let Ok(rows) = rows {
            for (id, p) in rows.filter_map(Result::ok) {
                out.entry(id).or_default().push(p);
            }
        }
        out
    }
}

/// 1 件のベクトル。whole は区間の平均（区間がなければサムネイル）、text は名前・メモ・本文。
#[derive(Default)]
pub struct Entry {
    pub whole: Option<Vec<f32>>,
    pub parts: Vec<Part>,
    pub text: Option<Vec<f32>>,
}

pub type Index = HashMap<String, Entry>;

/// path のベクトルをすべて読む。書き換えがなければ、前に読んだものを返す。
pub fn index(path: &Path) -> Result<Arc<Index>, String> {
    static LOADED: Mutex<Option<(PathBuf, u64, Arc<Index>)>> = Mutex::new(None);
    let mut g = LOADED.lock().map_err(|e| e.to_string())?;
    let now = GEN.load(Ordering::Relaxed);
    if let Some((p, at, ix)) = g.as_ref()
        && p == path
        && *at == now
    {
        return Ok(Arc::clone(ix));
    }
    let s = Store::open(path)?;
    let now = GEN.load(Ordering::Relaxed);
    let mut ix = Index::new();
    for (id, v) in s.vecs("SELECT id, vec FROM content WHERE vec IS NOT NULL") {
        ix.entry(id).or_default().whole = Some(v);
    }
    for (id, ps) in s.parts() {
        ix.entry(id).or_default().parts = ps;
    }
    for (id, v) in s.vecs("SELECT id, vec FROM text") {
        ix.entry(id).or_default().text = Some(v);
    }
    let ix = Arc::new(ix);
    *g = Some((path.to_owned(), now, Arc::clone(&ix)));
    Ok(ix)
}
