//! 内容での検索。言葉のベクトルと、素材全体・区間・文章のベクトルを比べる。

use std::path::Path;

use serde::Serialize;

use crate::{embed, vectors};

const MAX_HITS: usize = 20;

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

/// 項目ごとに、いちばん近いものの点数を取る。文章は、ノートや中身を読めなかったものにだけ使う。
pub fn search(thumbs: &Path, query: &str) -> Result<Vec<Hit>, String> {
    let ix = vectors::index(&vectors::path_for(thumbs))?;
    let q = embed::text("search result", query)?;
    let mut hits: Vec<Hit> = ix
        .iter()
        .filter_map(|(id, e)| {
            let mut best: Option<(f32, Option<f64>)> = None;
            let mut consider = |s: f32, at: Option<f64>| {
                if best.is_none_or(|(b, _)| s > b) {
                    best = Some((s, at));
                }
            };
            if let Some(w) = &e.whole {
                consider(dot(&q, w), None);
            }
            for p in &e.parts {
                consider(dot(&q, &p.vec), p.start);
            }
            if e.whole.is_none()
                && let Some(t) = &e.text
            {
                consider(dot(&q, t), None);
            }
            let (score, at) = best?;
            Some(Hit {
                id: id.clone(),
                score,
                at,
            })
        })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    hits.truncate(MAX_HITS);
    Ok(hits)
}
