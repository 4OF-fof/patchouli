//! 区間と文章のベクトル。サムネイルと同じキャッシュ（thumbs/<ライブラリ>/embed）に置き、同期しない。
//! sig が変わった項目だけ作り直す。モデルが変わったら全部捨てる。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::embed::MODEL;

pub struct Part {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub kind: &'static str,
    pub vec: Vec<f32>,
}

pub struct Store(Connection);

pub fn path_for(thumbs: &Path) -> PathBuf {
    thumbs.join("embed").join("vectors.sqlite")
}

fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

impl Store {
    pub fn open(path: &Path) -> Result<Store, String> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let c = Connection::open(path).map_err(|e| e.to_string())?;
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, sig TEXT NOT NULL, vec BLOB);
             CREATE TABLE IF NOT EXISTS parts (id TEXT NOT NULL, k INTEGER NOT NULL, start REAL, end REAL, kind TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (id, k));
             CREATE TABLE IF NOT EXISTS text (id TEXT PRIMARY KEY, sig TEXT NOT NULL, vec BLOB NOT NULL);",
        )
        .map_err(|e| e.to_string())?;
        let model: Option<String> = c
            .query_row("SELECT value FROM meta WHERE key = 'model'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        if model.as_deref() != Some(MODEL) {
            c.execute_batch("DELETE FROM content; DELETE FROM parts; DELETE FROM text;")
                .map_err(|e| e.to_string())?;
            c.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('model', ?1)",
                [MODEL],
            )
            .map_err(|e| e.to_string())?;
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
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn put_text(&self, id: &str, sig: &str, vec: &[f32]) -> Result<(), String> {
        self.0
            .execute(
                "INSERT OR REPLACE INTO text (id, sig, vec) VALUES (?1, ?2, ?3)",
                params![id, sig, to_blob(vec)],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
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
        Ok(gone.len())
    }
}
