use std::time::Duration;

use serde::Deserialize;
use tauri::Url;

/// 落とす zip の大きさの上限。
const ZIP_MAX: u64 = 256 << 20;
const TIMEOUT: Duration = Duration::from_secs(60);
/// プレリリースも含めて探すときに見るリリースの数。
const RECENT: usize = 30;

#[derive(Debug, Clone)]
pub struct Release {
    pub tag: String,
    url: String,
}

#[derive(Deserialize)]
struct Raw {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// 「https://github.com/owner/name」「github.com/owner/name」「owner/name」から owner/name を取り出す。
pub fn repo_of(input: &str) -> Result<String, String> {
    let s = input.trim();
    let bad = || format!("「{s}」は GitHub のリポジトリの URL ではありません");
    let rest = match s.split_once("://") {
        Some((_, r)) => r
            .strip_prefix("www.")
            .unwrap_or(r)
            .strip_prefix("github.com/")
            .ok_or_else(bad)?,
        None => s.strip_prefix("github.com/").unwrap_or(s),
    };
    let mut parts = rest.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    let name = name.strip_suffix(".git").unwrap_or(name);
    let ok = |p: &str| {
        !p.is_empty()
            && p.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    };
    if ok(owner) && ok(name) {
        Ok(format!("{owner}/{name}"))
    } else {
        Err(bad())
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .user_agent(concat!("Patchouli/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn api(repo: &str, path: &[&str]) -> Result<Url, String> {
    let mut u = Url::parse("https://api.github.com/repos/").map_err(|e| e.to_string())?;
    u.path_segments_mut()
        .map_err(|()| "URL を作れません".to_string())?
        .pop_if_empty()
        .extend(repo.split('/'))
        .extend(path);
    Ok(u)
}

fn get<T: serde::de::DeserializeOwned>(repo: &str, url: &Url, missing: &str) -> Result<T, String> {
    match agent()
        .get(url.as_str())
        .header("Accept", "application/vnd.github+json")
        .call()
    {
        Ok(mut res) => res
            .body_mut()
            .read_json()
            .map_err(|e| format!("{repo}: {e}")),
        Err(ureq::Error::StatusCode(404)) => Err(format!("{repo}: {missing}")),
        Err(ureq::Error::StatusCode(403 | 429)) => {
            Err(format!("{repo}: GitHub への問い合わせの上限に達しました"))
        }
        Err(e) => Err(format!("{repo}: {e}")),
    }
}

/// 最新のリリース。prerelease のときは、プレリリースも含めていちばん新しいもの。
pub fn latest(repo: &str, prerelease: bool) -> Result<Release, String> {
    const NONE: &str = "リリースが見つかりません";
    let raw = if prerelease {
        let mut u = api(repo, &["releases"])?;
        u.query_pairs_mut()
            .append_pair("per_page", &RECENT.to_string());
        get::<Vec<Raw>>(repo, &u, NONE)?
            .into_iter()
            .find(|r| !r.draft)
            .ok_or_else(|| format!("{repo}: {NONE}"))?
    } else {
        get::<Raw>(repo, &api(repo, &["releases", "latest"])?, NONE)?
    };
    release(repo, raw)
}

pub fn tagged(repo: &str, tag: &str) -> Result<Release, String> {
    let raw = get::<Raw>(
        repo,
        &api(repo, &["releases", "tags", tag])?,
        &format!("タグ「{tag}」のリリースが見つかりません"),
    )?;
    release(repo, raw)
}

/// zip が 1 つだけならそれを、いくつもあれば「<id>-<版>.zip」の形のものを選ぶ。
fn release(repo: &str, raw: Raw) -> Result<Release, String> {
    let zips: Vec<&Asset> = raw
        .assets
        .iter()
        .filter(|a| a.name.to_ascii_lowercase().ends_with(".zip"))
        .collect();
    let ver = raw.tag_name.trim_start_matches(['v', 'V']);
    let tail = format!("-{ver}.zip");
    let picked = match zips.as_slice() {
        [one] => Some(*one),
        [] => None,
        many => {
            let named: Vec<&&Asset> = many.iter().filter(|a| a.name.ends_with(&tail)).collect();
            match named.as_slice() {
                [one] => Some(**one),
                _ => {
                    return Err(format!(
                        "{repo}: リリース「{}」に ZIP ファイルが複数あるため、インストールするファイルを特定できません",
                        raw.tag_name
                    ));
                }
            }
        }
    };
    let a = picked.ok_or_else(|| {
        format!(
            "{repo}: リリース「{}」に ZIP ファイルがありません",
            raw.tag_name
        )
    })?;
    Ok(Release {
        tag: raw.tag_name,
        url: a.browser_download_url.clone(),
    })
}

pub fn download(repo: &str, r: &Release) -> Result<Vec<u8>, String> {
    let err = |e: ureq::Error| format!("{repo}: {e}");
    agent()
        .get(&r.url)
        .call()
        .map_err(err)?
        .body_mut()
        .with_config()
        .limit(ZIP_MAX)
        .read_to_vec()
        .map_err(err)
}
