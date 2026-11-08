use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};

use crate::library::{LibraryState, StoredGroup, StoredItem, StoredProject, meta_path, mtime_of};
use crate::plugin::Reads;

/// 中身の形を変えたら上げる。違う版の写しは捨てて作り直す。
const VERSION: i32 = 7;

/// この版から、波形から描いたサムネイルをジャケットと別の場所に置く。
const WAVE_THUMBS_APART: i32 = 5;

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

    /// フォルダを読んだときに取れた更新日時から作る。of と同じ値になる
    pub fn from_times(file: f64, meta: f64, note: bool) -> Sig {
        Sig {
            file,
            meta: if note { 0.0 } else { meta },
        }
    }
}

#[derive(Debug, Clone)]
pub struct Row {
    pub item: StoredItem,
    pub saved: bool,
    pub sig: Sig,
}

impl Row {
    pub fn same_item(&self, other: &Row) -> bool {
        self.item == other.item
    }
}

pub struct Snapshot {
    pub rows: Vec<Row>,
    pub projects: Vec<StoredProject>,
    pub groups: Vec<StoredGroup>,
    pub state: LibraryState,
    pub tag_covers: Map<String, Value>,
}

pub struct Cache(Mutex<Connection>, AtomicBool, Mutex<Changed>);

/// 項目を書き換えるたびに上げる番号。開き直した写しどうしでも重ならないよう、全体で 1 つ。
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::Relaxed) + 1
}

/// since より後に、どの項目がいつ変わったか。
struct Changed {
    since: u64,
    ids: HashMap<String, u64>,
}

impl Changed {
    fn fresh() -> Changed {
        Changed {
            since: next_generation(),
            ids: HashMap::new(),
        }
    }
}

fn warn(what: &str, e: impl std::fmt::Display) {
    log::warn!("ライブラリの写しを{what}: {e}");
}

pub fn path_for(cache: &Path, root: &Path) -> PathBuf {
    cache.join("library").join(format!(
        "{:016x}.sqlite",
        crate::thumb::fnv(&[root.as_os_str().as_encoded_bytes()])
    ))
}

const KEEP: Duration = Duration::from_secs(180 * 24 * 60 * 60);

pub fn touch(path: &Path) {
    if let Ok(f) = std::fs::File::options().write(true).open(path)
        && let Err(e) = f.set_modified(SystemTime::now())
    {
        warn("開いた日を書けない", e);
    }
}

pub fn sweep(cache: &Path, root: &Path) {
    let current = path_for(cache, root);
    let Some(current) = current.file_stem().and_then(|s| s.to_str()) else {
        return;
    };
    let library = cache.join("library");
    let old = |p: &Path| {
        std::fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|d| d > KEEP)
    };
    let others = |dir: &Path| -> Vec<(String, PathBuf)> {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        rd.filter_map(Result::ok)
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                // 「<16 桁>」で始まるものだけ（写しは -wal などが付くこともある）
                let key = name.get(..16)?;
                (key.bytes().all(|b| b.is_ascii_hexdigit()) && key != current)
                    .then(|| (key.to_owned(), e.path()))
            })
            .collect()
    };
    // 写しを消すと目印がなくなるので、サムネイルから消す
    for (key, dir) in others(&cache.join("thumbs")) {
        let opened = library.join(format!("{key}.sqlite"));
        if old(if opened.exists() { &opened } else { &dir })
            && let Err(e) = std::fs::remove_dir_all(&dir)
        {
            log::warn!("使わなくなったサムネイルを消せない: {}: {e}", dir.display());
        }
    }
    for (key, file) in others(&library) {
        if (old(&library.join(format!("{key}.sqlite"))) || old(&file))
            && let Err(e) = std::fs::remove_file(&file)
        {
            warn("消せない", e);
        }
    }
}

/// 写しと、波形のサムネイルをジャケットと同じ場所に置いていた版から作り直したかを返す。
fn connect(path: &Path) -> rusqlite::Result<(Connection, bool)> {
    let c = Connection::open(path)?;
    c.busy_timeout(std::time::Duration::from_secs(5))?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    let v: i32 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let mixed = v != 0 && v < WAVE_THUMBS_APART;
    if v != VERSION {
        c.execute_batch(
            "DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS groups; DROP TABLE IF EXISTS state;
            DROP TABLE IF EXISTS tag_covers; DROP TABLE IF EXISTS thumb_reads;",
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
        CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, dir TEXT NOT NULL, grp TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 0), state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tag_covers (id INTEGER PRIMARY KEY CHECK (id = 0), covers TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS thumb_reads (path TEXT PRIMARY KEY, reads TEXT NOT NULL);",
    )?;
    Ok((c, mixed))
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

fn put_groups(c: &Connection, groups: &[StoredGroup]) -> Result<(), String> {
    let mut st = c
        .prepare_cached("INSERT OR REPLACE INTO groups (id, dir, grp) VALUES (?1, ?2, ?3)")
        .map_err(|e| e.to_string())?;
    for g in groups {
        let json = serde_json::to_string(g).map_err(|e| e.to_string())?;
        st.execute(params![g.id, g.dir.to_string_lossy(), json])
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

fn put_tag_covers(c: &Connection, covers: &Map<String, Value>) -> Result<(), String> {
    let json = serde_json::to_string(covers).map_err(|e| e.to_string())?;
    c.execute(
        "INSERT OR REPLACE INTO tag_covers (id, covers) VALUES (0, ?1)",
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
                let c = Connection::open_in_memory().expect("メモリの中に SQLite を開けない");
                (c, false)
            });
        Cache(
            Mutex::new(c.0),
            AtomicBool::new(c.1),
            Mutex::new(Changed::fresh()),
        )
    }

    /// 波形のサムネイルをジャケットと同じ場所に置いていた版から作り直したか。最初に聞かれたときだけ true を返す。
    pub fn take_mixed_thumbs(&self) -> bool {
        self.1.swap(false, Ordering::Relaxed)
    }

    fn with<T>(
        &self,
        what: &str,
        f: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut g = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        f(&mut g).map_err(|e| format!("ライブラリの写しを{what}: {e}"))
    }

    pub fn load(&self) -> Result<Option<Snapshot>, String> {
        let state = self.with("読めない", |c| {
            let s: Option<String> = c
                .query_row("SELECT state FROM state WHERE id = 0", [], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            s.map(|s| serde_json::from_str::<LibraryState>(&s).map_err(|e| e.to_string()))
                .transpose()
        })?;
        let Some(state) = state else {
            return Ok(None);
        };
        let mut rows: Vec<Row> = self.rows()?.into_values().collect();
        rows.sort_by(|a, b| a.item.file.cmp(&b.item.file));
        Ok(Some(Snapshot {
            rows,
            projects: self.projects()?,
            groups: self.groups()?,
            state,
            tag_covers: self.tag_covers()?,
        }))
    }

    pub fn rows(&self) -> Result<HashMap<PathBuf, Row>, String> {
        self.query_rows("", [])
    }

    /// ノートの行だけ。
    pub fn note_rows(&self) -> Result<HashMap<PathBuf, Row>, String> {
        self.query_rows("WHERE json_extract(item, '$.note') = 1", [])
    }

    pub fn row(&self, path: &Path) -> Result<Option<Row>, String> {
        Ok(self
            .query_rows("WHERE path = ?1", [path.to_string_lossy()])?
            .into_values()
            .next())
    }

    fn query_rows<P: rusqlite::Params>(
        &self,
        filter: &str,
        params: P,
    ) -> Result<HashMap<PathBuf, Row>, String> {
        self.with("読めない", |c| {
            let mut st = c
                .prepare(&format!(
                    "SELECT file_mtime, meta_mtime, saved, item FROM items {filter}"
                ))
                .map_err(|e| e.to_string())?;
            let it = st
                .query_map(params, |r| {
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

    pub fn projects(&self) -> Result<Vec<StoredProject>, String> {
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

    pub fn groups(&self) -> Result<Vec<StoredGroup>, String> {
        self.groups_where("", [])
    }

    pub fn group(&self, id: &str) -> Result<Option<StoredGroup>, String> {
        Ok(self.groups_where("WHERE id = ?1", [id])?.pop())
    }

    fn groups_where<P: rusqlite::Params>(
        &self,
        filter: &str,
        p: P,
    ) -> Result<Vec<StoredGroup>, String> {
        self.with("読めない", |c| {
            let mut st = c
                .prepare(&format!("SELECT grp FROM groups {filter} ORDER BY dir"))
                .map_err(|e| e.to_string())?;
            let it = st
                .query_map(p, |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for g in it {
                let g = g.map_err(|e| e.to_string())?;
                out.push(serde_json::from_str(&g).map_err(|e| e.to_string())?);
            }
            Ok(out)
        })
    }

    pub fn state(&self) -> Result<LibraryState, String> {
        self.with("読めない", |c| {
            let s: Option<String> = c
                .query_row("SELECT state FROM state WHERE id = 0", [], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            Ok(s.and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default())
        })
    }

    pub fn tag_covers(&self) -> Result<Map<String, Value>, String> {
        self.with("読めない", |c| {
            let s: Option<String> = c
                .query_row("SELECT covers FROM tag_covers WHERE id = 0", [], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| e.to_string())?;
            Ok(s.and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default())
        })
    }

    pub fn replace(
        &self,
        rows: &[Row],
        projects: &[StoredProject],
        groups: &[StoredGroup],
        state: &LibraryState,
        tag_covers: &Map<String, Value>,
    ) -> Result<(), String> {
        *self.2.lock().unwrap_or_else(PoisonError::into_inner) = Changed::fresh();
        self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch("DELETE FROM items; DELETE FROM projects; DELETE FROM groups;")
                .map_err(|e| e.to_string())?;
            put_rows(&tx, rows)?;
            put_projects(&tx, projects)?;
            put_groups(&tx, groups)?;
            put_state(&tx, state)?;
            put_tag_covers(&tx, tag_covers)?;
            tx.commit().map_err(|e| e.to_string())
        })
    }

    pub fn update(&self, rows: &[Row], gone: &[PathBuf]) -> Result<(), String> {
        if rows.is_empty() && gone.is_empty() {
            return Ok(());
        }
        let gone_ids = self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            put_rows(&tx, rows)?;
            let mut ids = Vec::new();
            for p in gone {
                let id = tx
                    .query_row(
                        "SELECT json_extract(item, '$.id') FROM items WHERE path = ?1",
                        [p.to_string_lossy()],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                ids.extend(id);
                for sql in [
                    "DELETE FROM items WHERE path = ?1",
                    "DELETE FROM thumb_reads WHERE path = ?1",
                ] {
                    tx.execute(sql, [p.to_string_lossy()])
                        .map_err(|e| e.to_string())?;
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(ids)
        })?;
        let at = next_generation();
        let mut g = self.2.lock().unwrap_or_else(PoisonError::into_inner);
        for id in rows.iter().map(|r| &r.item.id).chain(&gone_ids) {
            g.ids.insert(id.clone(), at);
        }
        Ok(())
    }

    /// いまの番号。これより後の書き換えは changed_since で分かる。
    pub fn generation(&self) -> u64 {
        GENERATION.load(Ordering::Relaxed)
    }

    /// generation より後に変わった項目の ID。丸ごと入れ替えたあとなど、分からなければ None。
    pub fn changed_since(&self, generation: u64) -> Option<Vec<String>> {
        let g = self.2.lock().unwrap_or_else(PoisonError::into_inner);
        (generation >= g.since).then(|| {
            g.ids
                .iter()
                .filter(|(_, at)| **at > generation)
                .map(|(id, _)| id.clone())
                .collect()
        })
    }

    pub fn put_project(&self, project: &StoredProject) -> Result<(), String> {
        self.with("書けない", |c| {
            put_projects(c, std::slice::from_ref(project))
        })
    }

    pub fn replace_projects(&self, projects: &[StoredProject]) -> Result<(), String> {
        self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM projects", [])
                .map_err(|e| e.to_string())?;
            put_projects(&tx, projects)?;
            tx.commit().map_err(|e| e.to_string())
        })
    }

    pub fn put_group(&self, group: &StoredGroup) -> Result<(), String> {
        self.with("書けない", |c| {
            put_groups(c, std::slice::from_ref(group))
        })
    }

    pub fn replace_groups(&self, groups: &[StoredGroup]) -> Result<(), String> {
        self.with("書けない", |c| {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM groups", [])
                .map_err(|e| e.to_string())?;
            put_groups(&tx, groups)?;
            tx.commit().map_err(|e| e.to_string())
        })
    }

    pub fn put_state(&self, state: &LibraryState) -> Result<(), String> {
        self.with("書けない", |c| put_state(c, state))
    }

    pub fn put_tag_covers(&self, covers: &Map<String, Value>) -> Result<(), String> {
        self.with("書けない", |c| put_tag_covers(c, covers))
    }

    pub fn set_thumb(
        &self,
        src: &Path,
        thumb: &Path,
        (width, height): (u32, u32),
        reads: &Reads,
    ) -> Result<(), String> {
        let Some(mut row) = self.row(src)? else {
            return Ok(());
        };
        row.item.thumb = Some(thumb.to_owned());
        row.item.wave_thumb = crate::thumb::is_wave_thumb(thumb);
        if row.item.width.is_none() {
            (row.item.width, row.item.height) = (Some(width), Some(height));
        }
        self.update(&[row], &[])?;
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

    pub fn thumb_read(&self, path: &Path) -> Result<Option<Reads>, String> {
        self.with("読めない", |c| {
            c.query_row(
                "SELECT reads FROM thumb_reads WHERE path = ?1",
                [path.to_string_lossy()],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .map(|reads| serde_json::from_str(&reads).map_err(|e| e.to_string()))
            .transpose()
        })
    }

    pub fn thumb_reads(&self) -> Result<HashMap<PathBuf, Reads>, String> {
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
