//! 画面とのやりとりで、JSON の頭と中身をまとめて 1 つの本文にする。頭の 4 バイトが JSON の長さで、JSON、中身と続く。

use serde::Serialize;
use serde::de::DeserializeOwned;

pub fn join(head: &impl Serialize, rest: &[u8]) -> Result<Vec<u8>, String> {
    let head = serde_json::to_vec(head).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + head.len() + rest.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(rest);
    Ok(out)
}

/// 頭と、残りの中身。失敗したときは「形がありません」のように、何が悪いかだけを返す。
pub fn split<T: DeserializeOwned>(body: &[u8]) -> Result<(T, &[u8]), String> {
    let len = body
        .first_chunk::<4>()
        .map(|b| u32::from_le_bytes(*b) as usize)
        .ok_or("形がありません")?;
    let head = body.get(4..4 + len).ok_or("形が足りません")?;
    let head = serde_json::from_slice(head).map_err(|_| "形を読めません")?;
    Ok((head, &body[4 + len..]))
}
