//! 内容での検索。言葉のベクトルと、素材全体・区間・文章のベクトルを比べる。

use std::path::Path;

use serde::Serialize;

use crate::{embed, vectors};

const MAX_HITS: usize = 20;
/// 区間の多い素材は、どの言葉にも近い区間が 1 つは出やすいので、区間の数で割り引く。
const PER_PARTS: f32 = 0.01;

#[derive(Serialize)]
pub struct Hit {
    id: String,
    score: f32,
    /// 当たった区間の始まり（秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    at: Option<f64>,
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// 項目ごとに、いちばん近い区間の点数を取る。文章は、ノートや中身を読めなかったものにだけ使う。
pub fn search(thumbs: &Path, query: &str) -> Result<Vec<Hit>, String> {
    let mut hits = score_all(thumbs, query)?;
    hits.truncate(MAX_HITS);
    Ok(hits)
}

/// プラグインの embed の similar。近い順の ID と点数。
pub fn similar(thumbs: &Path, text: &str, limit: usize) -> Result<Vec<(String, f32)>, String> {
    let mut hits = score_all(thumbs, text)?;
    hits.truncate(limit);
    Ok(hits.into_iter().map(|h| (h.id, h.score)).collect())
}

fn score_all(thumbs: &Path, query: &str) -> Result<Vec<Hit>, String> {
    let ix = vectors::index(&vectors::path_for(thumbs))?;
    let q = embed::text("search result", query)?;
    let mut hits: Vec<Hit> = ix
        .iter()
        .filter_map(|(id, e)| {
            let part = e
                .parts
                .iter()
                .map(|p| (dot(&q, &p.vec), p.start))
                .max_by(|a, b| a.0.total_cmp(&b.0));
            let whole = e.whole.as_ref().map(|w| dot(&q, w));
            let (score, at) = match (part, whole) {
                (Some((s, at)), _) => (s - PER_PARTS * (e.parts.len() as f32).ln(), at),
                (None, Some(w)) => (w, None),
                (None, None) => (dot(&q, e.text.as_ref()?), None),
            };
            Some(Hit {
                id: id.clone(),
                score,
                at,
            })
        })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(hits)
}
