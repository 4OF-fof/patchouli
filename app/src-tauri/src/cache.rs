//! ライブラリを開いた結果の写し。端末のキャッシュに SQLite で置き、次に開くときはまずこれを返す（消してもまた作れる）。
//!
//! 素材とノートはファイルごとの行に持つ。更新日時が前と同じファイルは、確かめるときに読み直さない。
//! 書けなくても開くのは止めない。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use crate::library::{LibraryState, StoredItem, StoredProject, meta_path, mtime_of};
use crate::plugin::Reads;

/// 中身の形を変えたら上げる。違う版の写しは捨てて作り直す。
const VERSION: i32 = 1;

/// 読んだときのファイルの更新日時（UNIX ミリ秒）。素材は .meta のものも見る（ないときは 0）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sig {
    file: f64,
    meta: f64,
}

impl Sig {
    pub fn of(path: &Path, note: bool) -> Sig {
        Sig {
            file: mtime_of(path),
            meta: if note {
                0.0
            } else {
                mtime_of(&meta_path(path))
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct Row {
    pub item: StoredItem,
    /// ID がファイルに書いてある。
    pub saved: bool,
    pub sig: Sig,
}

impl Row {
    /// 画面に渡す中身が同じか。
    pub fn same_item(&self, other: &Row) -> bool {
        serde_json::to_value(&self.item).ok() == serde_json::to_value(&other.item).ok()
    }
}

pub struct Snapshot {
    pub rows: Vec<Row>,
    pub projects: Vec<StoredProject>,
    pub state: LibraryState,
}

pub struct Cache(Mutex<Connection>);

fn warn(what: &str, e: impl std::fmt::Display) {
    log::warn!("ライブラリの写しを{what}: {e}");
}

/// ライブラリごとの写しの場所。
pub fn path_for(cache: &Path, root: &Path) -> PathBuf {
    cache.join("library").join(format!(
        "{:016x}.sqlite",
        crate::thumb::fnv(&[root.as_os_str().as_encoded_bytes()])
    ))
}

fn connect(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    let v: i32 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if v != VERSION {
        c.execute_batch(
            "DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS state;
            DROP TABLE IF EXISTS thumb_reads;",
        )?;
        c.pragma_update(None, "user_version", VERSION)?;
    }
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS items (
            path TEXT PRIMARY KEY,
            file_mtime REAL NOT NULL,
            meta_mtime REAL NOT NULL,
            saved INTEGER NOT NULL,
            item TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY, project TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 0), state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS thumb_reads (path TEXT PRIMARY KEY, reads TEXT NOT NULL);",
    )?;
    Ok(c)
}

fn put_rows(c: &Connection, rows: &[Row]) -> Result<(), String> {
    let mut st = c
        .prepare_cached(
            "INSERT OR REPLACE INTO items (path, file_mtime, meta_mtime, saved, item) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|e| e.to_string())?;
    for r in rows {
        let item = serde_json::to_string(&r.item).map_err(|e| e.to_string())?;
        st.execute(params![
            r.item.file.to_string_lossy(),
            r.sig.file,
            r.sig.meta,
            r.saved,
            item
        ])
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn put_projects(c: &Connection, projects: &[StoredProject]) -> Result<(), String> {
    let mut st = c
        .prepare_cached("INSERT OR REPLACE INTO projects (name, project) VALUES (?1, ?2)")
        .map_err(|e| e.to_string())?;
    for p in projects {
        let json = serde_json::to_string(p).map_err(|e| e.to_string())?;
        st.execute(params![p.name, json])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn put_state(c: &Connection, state: &LibraryState) -> Result<(), String> {
    let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
    c.execute(
        "INSERT OR REPLACE INTO state (id, state) VALUES (0, ?1)",
        [json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

impl Cache {
    /// 開けなければ作り直し、それでも開けなければメモリの中に置く（次に開くときは残らない）。
    pub fn open(path: &Path) -> Cache {
        if let Some(dir) = path.parent()
            && let Err(e) = std::fs::create_dir_all(dir)
        {
            warn("置くフォルダを作れない", e);
        }
        let c = connect(path)
            .or_else(|e| {
                warn("開けない", e);
                let _ = std::fs::remove_file(path);
                connect(path)
            })
            .unwrap_or_else(|e| {
                warn("作れない", e);
                Connection::open_in_memory().expect("メモリの中に SQLite を開けない")
            });
        Cache(Mutex::new(c))
    }

    fn with<T: Default>(
        &self,
        what: &str,
        f: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> T {
        let mut g = match self.0.lock() {
            Ok(g) => g,
            Err(e) => {
                warn(what, e);
                return T::default();
            }
        };
        f(&mut g).unwrap_or_else(|e| {
            warn(what, e);
            T::default()
        })
    }

    /// 前に開いたときの写し。まだ一度も最後まで読んでいなければ None。
    pub fn load(&self) -> Option<Snapshot> {
        let state = self.with("読めない", |c| {
            let s: Option<String> = c
                .query_row("SELECT state FROM state WHERE id = 0", [], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            s.map(|s| serde_json::from_str::<LibraryState>(&s).map_err(|e| e.to_string()))
                .transpose()
        })?;
        let mut rows: Vec<Row> = self.rows().into_values().collect();
        rows.sort_by(|a, b| a.item.file.cmp(&b.item.file));
        Some(Snapshot {
            rows,
            projects: self.projects(),
            state,
        })
    }

    /// 素材とノートの行（ファイルの場所 → 行）。読めない行は除く。
    pub fn rows(&self) -> HashMap<PathBuf, Row> {
        self.with("読めない", |c| {
            let mut st = c
                .prepare("SELECT file_mtime, meta_mtime, saved, item FROM items")
                .map_err(|e| e.to_string())?;
            let it = st
                .query_map([], |r| {
                    Ok((
                        Sig {
                            file: r.get(0)?,
                            meta: r.get(1)?,
                        },
                        r.get::<_, bool>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            let mut out = HashMap::new();
            for r in it {
                let (sig, saved, item) = r.map_err(|e| e.to_string())?;
                match serde_json::from_str::<StoredItem>(&item) {
                    Ok(item) => {
                        out.insert(item.file.clone(), Row { item, saved, sig });
                    }
                    Err(e) => warn("一部読めない", e),
                }
            }
            Ok(out)
        })
    }

    pub fn row(&self, path: &Path) -> Option<Row> {
        self.with("読めない", |c| {
            c.query_row(
                "SELECT file_mtime, meta_mtime, saved, item FROM items WHERE path = ?1",
                [path.to_string_lossy()],
                |r| {
                    Ok((
                        Sig {
                            file: r.get(0)?,
                            meta: r.get(1)?,
                        },
                        r.get::<_, bool>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .map(|(sig, saved, item)| {
                let item = serde_json::from_str(&item).map_err(|e| e.to_string())?;
                Ok(Row { item, saved, sig })
            })
            .transpose()
        })
    }

    pub fn projects(&self) -> Vec<StoredProject> {
        self.with("読めない", |c| {
            let mut st = c
                .prepare("SELECT project FROM projects ORDER BY name")
                .map_err(|e| e.to_string())?;
            let it = st
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for p in it {
                let p = p.map_err(|e| e.to_string())?;
                out.push(serde_json::from_str(&p).map_err(|e| e.to_string())?);
            }
            Ok(out)
        })
    }

    pub fn state(&self) -> LibraryState {
        self.with("読めない", |c| {
            let s: Option<String> = c
                .query_row("SELECT state FROM state WHERE id = 0", [], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            Ok(s.and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default())
        })
    }

    /// 全部を入れ替える。
    pub fn replace(&self, rows: &[Row], projects: &[StoredProject], state: &LibraryState) {
        self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch("DELETE FROM items; DELETE FROM projects;")
                .map_err(|e| e.to_string())?;
            put_rows(&tx, rows)?;
            put_projects(&tx, projects)?;
            put_state(&tx, state)?;
            tx.commit().map_err(|e| e.to_string())
        })
    }

    /// 行を足すか書き換え、gone の場所の行を消す。
    pub fn update(&self, rows: &[Row], gone: &[PathBuf]) {
        if rows.is_empty() && gone.is_empty() {
            return;
        }
        self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            put_rows(&tx, rows)?;
            for p in gone {
                for sql in [
                    "DELETE FROM items WHERE path = ?1",
                    "DELETE FROM thumb_reads WHERE path = ?1",
                ] {
                    tx.execute(sql, [p.to_string_lossy()])
                        .map_err(|e| e.to_string())?;
                }
            }
            tx.commit().map_err(|e| e.to_string())
        })
    }

    pub fn put_project(&self, project: &StoredProject) {
        self.with("書けない", |c| {
            put_projects(c, std::slice::from_ref(project))
        })
    }

    /// プロジェクトを全部入れ替える。
    pub fn replace_projects(&self, projects: &[StoredProject]) {
        self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM projects", [])
                .map_err(|e| e.to_string())?;
            put_projects(&tx, projects)?;
            tx.commit().map_err(|e| e.to_string())
        })
    }

    pub fn put_state(&self, state: &LibraryState) {
        self.with("書けない", |c| put_state(c, state))
    }

    /// src のサムネイルができたことを、作るときに読んだ設定と一緒に書く。大きさは、わからなかったときだけ size で埋める。
    pub fn set_thumb(&self, src: &Path, thumb: &Path, (width, height): (u32, u32), reads: &Reads) {
        let Some(mut row) = self.row(src) else {
            return;
        };
        row.item.thumb = Some(thumb.to_owned());
        if row.item.width.is_none() {
            (row.item.width, row.item.height) = (Some(width), Some(height));
        }
        self.update(&[row], &[]);
        self.with("書けない", |c| {
            let path = src.to_string_lossy();
            if reads.is_empty() {
                c.execute("DELETE FROM thumb_reads WHERE path = ?1", [path])
            } else {
                let json = serde_json::to_string(reads).map_err(|e| e.to_string())?;
                c.execute(
                    "INSERT OR REPLACE INTO thumb_reads (path, reads) VALUES (?1, ?2)",
                    params![path, json],
                )
            }
            .map(drop)
            .map_err(|e| e.to_string())
        })
    }

    /// サムネイルを作るときに読んだ設定（素材の場所 → 設定）。設定を読まなかったものは入れない。
    pub fn thumb_reads(&self) -> HashMap<PathBuf, Reads> {
        self.with("読めない", |c| {
            let mut st = c
                .prepare("SELECT path, reads FROM thumb_reads")
                .map_err(|e| e.to_string())?;
            let it = st
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            let mut out = HashMap::new();
            for r in it {
                let (path, reads) = r.map_err(|e| e.to_string())?;
                match serde_json::from_str(&reads) {
                    Ok(reads) => {
                        out.insert(PathBuf::from(path), reads);
                    }
                    Err(e) => warn("一部読めない", e),
                }
            }
            Ok(out)
        })
    }
}
