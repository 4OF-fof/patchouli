//! タグの候補。6 つの特徴（語の近さ・語の一致・中身の近い項目のタグ・文章の近い項目のタグ・タグ名との近さ・
//! 同じプロジェクトのタグ）を、ロジスティック回帰でまとめる。判断が 100 件たまったら重みを学習し、
//! 取り分けで手の重みより当たるときだけ使う。

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::decisions::{self, Decision};
use crate::library::StoredItem;
use crate::{embed, vectors};

const STOP: &[&str] = &[
    "img", "dsc", "image", "download", "untitled", "copy", "final", "rec", "audio", "sound",
    "clip", "voice", "画像", "jpg", "png", "wav", "mp4", "bg",
];
const WEIGHTS: [f32; 6] = [1.5, 2.0, 3.0, 1.5, 0.6, 1.5];
const BIAS: f32 = -3.0;
/// これより判断が少ないうちは、手で決めた重みを使う。
const LEARN_MIN: usize = 100;
const NEIGHBORS: usize = 5;

#[derive(Debug, Clone, Serialize)]
pub struct TagCandidate {
    tag: String,
    conf: &'static str,
    on: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    tags: Vec<TagCandidate>,
    order: usize,
}

type Weights = ([f32; 6], f32);

#[derive(Serialize, Deserialize)]
struct SavedWeights {
    weights: [f32; 6],
    bias: f32,
}

struct Entry {
    id: String,
    /// プロジェクトかグループに入っているか
    filed: bool,
    project: Option<String>,
    tags: Vec<String>,
    content: Option<Vec<f32>>,
    text: Option<Vec<f32>>,
    words: Vec<(&'static str, String)>,
}

struct Model {
    entries: Vec<Entry>,
    tags: Vec<String>,
    tag_sim: Vec<Vec<f32>>,
    tag_cls: Vec<Vec<f32>>,
    words: HashMap<String, Vec<f32>>,
    /// 語ごとの、その語が出る項目の数
    df: HashMap<String, usize>,
    weights: Weights,
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn sigmoid(z: f32) -> f32 {
    1.0 / (1.0 + (-z).exp())
}

fn leaf(tag: &str) -> &str {
    tag.rsplit('/').next().unwrap_or(tag)
}

/// 語どうしの近さは狭い範囲に固まるので、全タグとの近さの中でどれだけ抜けているかで見る
fn standardize(raw: Vec<f32>) -> Vec<f32> {
    let n = raw.len().max(1) as f32;
    let mean = raw.iter().sum::<f32>() / n;
    let sd = (raw.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / n)
        .sqrt()
        .max(1e-6);
    raw.into_iter().map(|x| (x - mean) / sd).collect()
}

fn split_digits(w: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut last: Option<bool> = None;
    for c in w.chars() {
        let d = c.is_ascii_digit();
        if last.is_some_and(|l| l != d) {
            out.push(String::new());
        }
        if let Some(s) = out.last_mut() {
            s.push(c);
        }
        last = Some(d);
    }
    out
}

/// 名前とメモ・本文から取る語と、その出どころ。
fn words_of(it: &StoredItem) -> Vec<(&'static str, String)> {
    static CAMEL: OnceLock<Regex> = OnceLock::new();
    static SEP: OnceLock<Regex> = OnceLock::new();
    static TERM: OnceLock<Regex> = OnceLock::new();
    let camel = CAMEL.get_or_init(|| Regex::new(r"([a-z])([A-Z])").expect("正しい正規表現"));
    let sep =
        SEP.get_or_init(|| Regex::new(r"[\s_\-.()（）\[\]、。・,]+").expect("正しい正規表現"));
    let term = TERM.get_or_init(|| {
        Regex::new(r"[\x{4e00}-\x{9fff}々]{2,}|[\x{30a0}-\x{30ff}ー]{2,}|[A-Za-z]{3,}")
            .expect("正しい正規表現")
    });
    let mut found: Vec<(&'static str, String)> = Vec::new();
    let name = camel.replace_all(&it.name, "$1 $2");
    for w in sep.split(&name) {
        found.extend(split_digits(w).into_iter().map(|w| ("名前", w)));
    }
    let src = if it.memo.is_empty() {
        "本文"
    } else {
        "メモ"
    };
    let text = format!("{}\n{}", it.memo, it.body.as_deref().unwrap_or(""));
    found.extend(term.find_iter(&text).map(|m| (src, m.as_str().to_owned())));
    let mut seen = HashSet::new();
    found
        .into_iter()
        .map(|(s, w)| (s, w.trim().to_lowercase()))
        .filter(|(_, w)| {
            let kanji = w
                .chars()
                .next()
                .is_some_and(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
            !w.is_empty()
                && !w.chars().all(|c| c.is_ascii_digit())
                && !STOP.contains(&w.as_str())
                && (w.chars().count() >= 2 || kanji)
        })
        .filter(|(_, w)| seen.insert(w.clone()))
        .collect()
}

impl Model {
    fn word_z(&self, v: &[f32]) -> Vec<f32> {
        standardize(self.tag_sim.iter().map(|t| dot(v, t)).collect())
    }

    /// タグの付いたほかの項目のうち、近い順に NEIGHBORS 件（近さ・番号）。
    fn near(&self, i: usize, pick: impl Fn(&Entry) -> Option<&[f32]>) -> Vec<(f32, usize)> {
        let Some(v) = pick(&self.entries[i]) else {
            return Vec::new();
        };
        let mut near: Vec<(f32, usize)> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(j, o)| *j != i && !o.tags.is_empty())
            .filter_map(|(j, o)| pick(o).map(|w| (dot(v, w), j)))
            .collect();
        near.sort_by(|a, b| b.0.total_cmp(&a.0));
        near.truncate(NEIGHBORS);
        near
    }

    fn vote(&self, near: &[(f32, usize)], tag: &str) -> f32 {
        let total: f32 = near.iter().map(|(s, _)| s.max(0.0)).sum();
        if total <= 0.0 {
            return 0.0;
        }
        near.iter()
            .filter(|(_, j)| self.entries[*j].tags.iter().any(|t| t == tag))
            .map(|(s, _)| s.max(0.0))
            .sum::<f32>()
            / total
    }

    /// self.tags の順に、タグごとの特徴。
    fn features(&self, i: usize) -> Vec<[f32; 6]> {
        let e = &self.entries[i];
        let zero = match e.content.as_ref().or(e.text.as_ref()) {
            Some(base) => standardize(self.tag_cls.iter().map(|t| dot(base, t)).collect()),
            None => vec![0.0; self.tags.len()],
        };
        let wz: Vec<Vec<f32>> = e
            .words
            .iter()
            .filter_map(|(_, w)| self.words.get(w).map(|v| self.word_z(v)))
            .collect();
        let near_content = self.near(i, |o| o.content.as_deref());
        let near_text = self.near(i, |o| o.text.as_deref());
        let peers: Vec<&Entry> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(j, o)| {
                *j != i && e.project.is_some() && o.project == e.project && !o.tags.is_empty()
            })
            .map(|(_, o)| o)
            .collect();
        self.tags
            .iter()
            .enumerate()
            .map(|(k, t)| {
                let word = wz.iter().map(|z| z[k]).fold(f32::MIN, f32::max);
                let exact = e.words.iter().any(|(_, w)| *w == leaf(t).to_lowercase());
                let proj = if peers.is_empty() {
                    0.0
                } else {
                    peers.iter().filter(|o| o.tags.contains(t)).count() as f32 / peers.len() as f32
                };
                [
                    (word - 1.8).max(0.0),
                    if exact { 1.0 } else { 0.0 },
                    self.vote(&near_content, t),
                    self.vote(&near_text, t),
                    zero[k],
                    proj,
                ]
            })
            .collect()
    }

    fn scores(&self, i: usize) -> Vec<(String, f32)> {
        let (w, b) = self.weights;
        let mut out: Vec<(String, f32)> = self
            .tags
            .iter()
            .zip(self.features(i))
            .map(|(t, f)| (t.clone(), sigmoid(b + dot(&w, &f))))
            .collect();
        out.sort_by(|a, b| b.1.total_cmp(&a.1));
        out
    }

    /// まだどのタグにも近くない語のうち、2 件以上の項目に出るもの。名前の語は、4 文字以上の英字だけ。
    fn new_words(&self, i: usize) -> Vec<String> {
        self.entries[i]
            .words
            .iter()
            .filter(|(src, w)| {
                let Some(v) = self.words.get(w) else {
                    return false;
                };
                let best = self.word_z(v).into_iter().fold(f32::MIN, f32::max);
                let latin = w.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 4;
                best < 2.0 && self.df.get(w).is_some_and(|&n| n >= 2) && (*src != "名前" || latin)
            })
            .map(|(_, w)| w.clone())
            .collect()
    }

    fn candidates(&self, i: usize) -> (f32, Vec<TagCandidate>) {
        let scores = self.scores(i);
        let best = scores.first().map_or(0.0, |x| x.1);
        let mut tags: Vec<TagCandidate> = scores
            .into_iter()
            .filter(|(_, p)| *p >= 0.15)
            .take(4)
            .map(|(tag, p)| TagCandidate {
                tag,
                conf: if p >= 0.7 {
                    "類似度：高"
                } else if p >= 0.4 {
                    "類似度：中"
                } else {
                    "類似度：低"
                },
                on: p >= 0.5,
            })
            .collect();
        tags.extend(
            self.new_words(i)
                .into_iter()
                .take(2)
                .map(|tag| TagCandidate {
                    tag,
                    conf: "新しいタグ",
                    on: false,
                }),
        );
        (best, tags)
    }

    /// タグのない項目の候補。どこにも入っていないもの、プロジェクトかグループに入っているもの、
    /// 候補の出ないものの順に、それぞれ自信の高い順に並べる。
    fn suggest(&self) -> HashMap<String, Suggestion> {
        let mut found: Vec<(u8, f32, usize, Vec<TagCandidate>)> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, e)| e.tags.is_empty() && (e.content.is_some() || e.text.is_some()))
            .map(|(i, e)| {
                let (best, tags) = self.candidates(i);
                let rank = if tags.is_empty() {
                    2
                } else {
                    u8::from(e.filed)
                };
                (rank, best, i, tags)
            })
            .collect();
        found.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.total_cmp(&a.1)));
        found
            .into_iter()
            .enumerate()
            .map(|(order, (_, _, i, tags))| {
                (self.entries[i].id.clone(), Suggestion { tags, order })
            })
            .collect()
    }

    fn log_loss(&self, w: &Weights, rows: &[([f32; 6], bool)]) -> f32 {
        let sum: f32 = rows
            .iter()
            .map(|(f, ok)| {
                let p = sigmoid(w.1 + dot(&w.0, f)).clamp(1e-4, 1.0 - 1e-4);
                if *ok { -p.ln() } else { -(1.0 - p).ln() }
            })
            .sum();
        sum / rows.len().max(1) as f32
    }

    /// 判断が LEARN_MIN 件あれば学習し、5 件に 1 件の取り分けで手の重みより当たるときだけ使う。
    fn learn(&self, ds: &[Decision]) -> Option<Weights> {
        let at: HashMap<&str, usize> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| (e.id.as_str(), i))
            .collect();
        let mut features: HashMap<usize, Vec<[f32; 6]>> = HashMap::new();
        let mut rows: Vec<([f32; 6], bool, bool)> = Vec::new();
        for d in ds {
            let (Some(&i), Some(k)) = (
                at.get(d.item.as_str()),
                self.tags.iter().position(|t| *t == d.tag),
            ) else {
                continue;
            };
            let f = features.entry(i).or_insert_with(|| self.features(i))[k];
            let held = crate::thumb::fnv(&[d.item.as_bytes()]).is_multiple_of(5);
            rows.push((f, d.ok, held));
        }
        if rows.len() < LEARN_MIN {
            return None;
        }
        let split = |held: bool| -> Vec<([f32; 6], bool)> {
            rows.iter()
                .filter(|r| r.2 == held)
                .map(|r| (r.0, r.1))
                .collect()
        };
        let (train, test) = (split(false), split(true));
        let learned = fit(&train);
        let hand = self.log_loss(&(WEIGHTS, BIAS), &test);
        let mine = self.log_loss(&learned, &test);
        log::info!(
            "重みを学習した: {} 件（取り分け {} 件）、手の重み {hand:.3} / 学習 {mine:.3}",
            rows.len(),
            test.len()
        );
        (mine < hand).then_some(learned)
    }
}

/// 手の重みから始めるロジスティック回帰。
fn fit(rows: &[([f32; 6], bool)]) -> Weights {
    let (mut w, mut b) = (WEIGHTS, BIAS);
    let n = rows.len().max(1) as f32;
    for _ in 0..2000 {
        let (mut gw, mut gb) = ([0.0f32; 6], 0.0f32);
        for (f, ok) in rows {
            let e = sigmoid(b + dot(&w, f)) - if *ok { 1.0 } else { 0.0 };
            gw.iter_mut().zip(f).for_each(|(g, x)| *g += e * x);
            gb += e;
        }
        w.iter_mut()
            .zip(gw)
            .for_each(|(w, g)| *w -= 0.3 * (g / n + 0.01 * *w));
        b -= 0.3 * gb / n;
    }
    (w, b)
}

fn build(
    root: &Path,
    thumbs: &Path,
    items: &[StoredItem],
    run: u64,
) -> Result<Option<Model>, String> {
    let path = vectors::path_for(thumbs);
    let ix = vectors::index(&path)?;
    let store = vectors::Store::open(&path)?;
    let stale = || RUN.load(Ordering::Relaxed) != run;
    let mut entries = Vec::new();
    let mut words: HashMap<String, Vec<f32>> = HashMap::new();
    for it in items {
        if stale() {
            return Ok(None);
        }
        let v = ix.get(&it.id);
        let ws = words_of(it);
        for (_, w) in &ws {
            if !words.contains_key(w) {
                let vec =
                    store.word(&format!("w:{w}"), || embed::text("sentence similarity", w))?;
                words.insert(w.clone(), vec);
            }
        }
        entries.push(Entry {
            id: it.id.clone(),
            filed: it.project.is_some() || it.group.is_some(),
            project: it.project.clone(),
            tags: it.tags.clone(),
            content: v.and_then(|e| e.whole.clone()),
            text: v.and_then(|e| e.text.clone()),
            words: ws,
        });
    }
    let tags: Vec<String> = entries
        .iter()
        .flat_map(|e| e.tags.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut tag_sim = Vec::with_capacity(tags.len());
    let mut tag_cls = Vec::with_capacity(tags.len());
    for t in &tags {
        if stale() {
            return Ok(None);
        }
        tag_sim.push(store.word(&format!("ts:{t}"), || {
            embed::text("sentence similarity", leaf(t))
        })?);
        tag_cls.push(store.word(&format!("tc:{t}"), || {
            embed::text("classification", leaf(t))
        })?);
    }
    let mut df: HashMap<String, usize> = HashMap::new();
    for (_, w) in entries.iter().flat_map(|e| &e.words) {
        *df.entry(w.clone()).or_default() += 1;
    }
    let mut m = Model {
        entries,
        tags,
        tag_sim,
        tag_cls,
        words,
        df,
        weights: (WEIGHTS, BIAS),
    };
    if let Some(w) = m.learn(&decisions::load(root)) {
        m.weights = w;
    }
    let saved = SavedWeights {
        weights: m.weights.0,
        bias: m.weights.1,
    };
    if let Ok(s) = serde_json::to_string(&saved) {
        let _ = std::fs::write(path.with_file_name("weights.json"), s);
    }
    Ok(Some(m))
}

static RUN: AtomicU64 = AtomicU64::new(0);

fn last() -> &'static Mutex<Option<Arc<Model>>> {
    static L: OnceLock<Mutex<Option<Arc<Model>>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(None))
}

/// 候補を作り直し、できたら send で渡す。新しく始めると、前のものは捨てる。
pub fn refresh(
    root: &Path,
    thumbs: &Path,
    items: Vec<StoredItem>,
    send: impl FnOnce(HashMap<String, Suggestion>) + Send + 'static,
) {
    let run = RUN.fetch_add(1, Ordering::Relaxed) + 1;
    let (root, thumbs) = (root.to_owned(), thumbs.to_owned());
    std::thread::spawn(move || {
        let started = Instant::now();
        match build(&root, &thumbs, &items, run) {
            Ok(Some(m)) => {
                let s = m.suggest();
                if RUN.load(Ordering::Relaxed) != run {
                    return;
                }
                log::info!(
                    "候補を作った: {} 件（{:.1} 秒）",
                    s.len(),
                    started.elapsed().as_secs_f32()
                );
                if let Ok(mut g) = last().lock() {
                    *g = Some(Arc::new(m));
                }
                send(s);
            }
            Ok(None) => {}
            Err(e) => log::warn!("候補を作れない: {e}"),
        }
    });
}

/// タグを付ける欄に出す候補。最後に作ったものから、id にまだ付いていないタグを選ぶ。
pub fn suggest_tags(id: &str) -> Vec<String> {
    let Some(m) = last().lock().ok().and_then(|g| g.clone()) else {
        return Vec::new();
    };
    let Some(i) = m.entries.iter().position(|e| e.id == id) else {
        return Vec::new();
    };
    let has = &m.entries[i].tags;
    let mut out: Vec<String> = m
        .scores(i)
        .into_iter()
        .filter(|(t, p)| *p >= 0.1 && !has.contains(t))
        .take(5)
        .map(|(t, _)| t)
        .collect();
    out.extend(m.new_words(i).into_iter().take(3));
    out
}
