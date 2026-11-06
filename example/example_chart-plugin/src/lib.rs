//! ノートの bars と tally のコードブロックを、棒グラフの SVG にする。
//! 中身は 1 行に 1 つの「名前: 数」で、数として読めない行は飛ばす。

wit_bindgen::generate!({
    inline: "
        package local:chart;

        world chart {
            include patchouli:plugin/code-role@0.13.0;
        }
    ",
    path: "../../app/plugins/sdk/wit",
    world: "local:chart/chart",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::types::CodeImage;

const WIDTH: f64 = 480.0;
const LABEL: f64 = 120.0;
const ROW: f64 = 28.0;
const BAR: f64 = 18.0;
/// 名前はこの文字数で切る。
const NAME: usize = 14;

struct Chart;

impl role::code::Guest for Chart {
    fn render(_lang: String, source: String) -> Result<CodeImage, String> {
        let rows = rows(&source);
        if rows.is_empty() {
            return Err("「名前: 数」の行がありません".into());
        }
        Ok(CodeImage::Svg(svg(&rows)))
    }
}

fn rows(source: &str) -> Vec<(String, f64)> {
    source
        .lines()
        .filter_map(|l| {
            let (name, n) = l.rsplit_once(':')?;
            let n: f64 = n.trim().parse().ok()?;
            let name: String = name.trim().chars().take(NAME).collect();
            (n.is_finite() && n >= 0.0).then_some((name, n))
        })
        .collect()
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn svg(rows: &[(String, f64)]) -> String {
    let max = rows.iter().map(|r| r.1).fold(0.0, f64::max);
    let room = WIDTH - LABEL - 48.0;
    let height = ROW * rows.len() as f64;
    let mut out = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}"><style>.ec-label,.ec-count{{font-family:var(--f-sans);font-size:13px;fill:var(--ink)}}.ec-count{{fill:var(--muted)}}.ec-bar{{fill:var(--accent)}}</style>"#
    );
    for (i, (name, n)) in rows.iter().enumerate() {
        let y = ROW * i as f64;
        let mid = y + ROW / 2.0;
        let w = if max > 0.0 { room * n / max } else { 0.0 };
        out += &format!(
            r#"<text class="ec-label" x="{}" y="{mid}" text-anchor="end" dominant-baseline="central">{}</text>"#,
            LABEL - 8.0,
            escape(name)
        );
        out += &format!(
            r#"<rect class="ec-bar" x="{LABEL}" y="{}" width="{w:.1}" height="{BAR}" rx="3"/>"#,
            y + (ROW - BAR) / 2.0
        );
        out += &format!(
            r#"<text class="ec-count" x="{:.1}" y="{mid}" dominant-baseline="central">{n}</text>"#,
            LABEL + w + 6.0
        );
    }
    out + "</svg>"
}

export!(Chart);
