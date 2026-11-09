//! サムネイルのアイコン。URL のサムネイルと同じ配置で、透かした地に灰色の線で描き、下に形式の名前を添える。

use tiny_skia::{Color, LineCap, LineJoin, Paint, Path, PathBuilder, Pixmap, Stroke, Transform};

/// plugin.json の ratio と同じ値。
const RATIO: f32 = 1.91;
const ICON: f32 = 0.3;
const FONT: f32 = 0.075;
const GAP: f32 = 0.06;

/// 字の寸法。フォントサイズを 1 とした割合で書く。
const LETTER_TOP: f32 = 0.135;
const LETTER_HEIGHT: f32 = 0.73;
const LETTER_WIDTH: f32 = 0.55;
const LETTER_GAP: f32 = 0.22;
const LETTER_LINE: f32 = 0.09;

type Line = &'static [(f32, f32)];

/// 字の形。幅 1・高さ 1 の枠の中の折れ線。
fn glyph(c: char) -> &'static [Line] {
    const BOWL: Line = &[
        (0., 1.),
        (0., 0.),
        (0.75, 0.),
        (1., 0.14),
        (1., 0.42),
        (0.75, 0.56),
        (0., 0.56),
    ];
    match c {
        'Z' => &[&[(0., 0.), (1., 0.), (0., 1.), (1., 1.)]],
        'I' => &[&[(0.5, 0.), (0.5, 1.)]],
        'P' => &[BOWL],
        '7' => &[&[(0., 0.), (1., 0.), (0.35, 1.)]],
        'R' => &[BOWL, &[(0.5, 0.56), (1., 1.)]],
        'A' => &[
            &[(0., 1.), (0.5, 0.), (1., 1.)],
            &[(0.2, 0.64), (0.8, 0.64)],
        ],
        'T' => &[&[(0., 0.), (1., 0.)], &[(0.5, 0.), (0.5, 1.)]],
        'G' => &[&[
            (1., 0.18),
            (0.75, 0.),
            (0.25, 0.),
            (0., 0.25),
            (0., 0.75),
            (0.25, 1.),
            (0.75, 1.),
            (1., 0.8),
            (1., 0.52),
            (0.55, 0.52),
        ]],
        'B' => &[
            &[
                (0., 0.),
                (0.72, 0.),
                (0.94, 0.12),
                (0.94, 0.36),
                (0.72, 0.5),
                (0., 0.5),
            ],
            &[
                (0.72, 0.5),
                (1., 0.64),
                (1., 0.88),
                (0.75, 1.),
                (0., 1.),
                (0., 0.),
            ],
        ],
        '2' => &[&[
            (0., 0.2),
            (0.25, 0.),
            (0.75, 0.),
            (1., 0.2),
            (1., 0.4),
            (0., 1.),
            (1., 1.),
        ]],
        'X' => &[&[(0., 0.), (1., 1.)], &[(1., 0.), (0., 1.)]],
        'S' => &[&[
            (1., 0.15),
            (0.75, 0.),
            (0.25, 0.),
            (0., 0.15),
            (0., 0.35),
            (0.25, 0.5),
            (0.75, 0.5),
            (1., 0.65),
            (1., 0.85),
            (0.75, 1.),
            (0.25, 1.),
            (0., 0.85),
        ]],
        _ => &[],
    }
}

fn gray() -> Paint<'static> {
    let mut p = Paint::default();
    // tokens.css の --muted
    p.set_color(Color::from_rgba8(0x8e, 0x92, 0x9a, 0xff));
    p.anti_alias = true;
    p
}

fn line(width: f32) -> Stroke {
    Stroke {
        width,
        line_cap: LineCap::Round,
        line_join: LineJoin::Round,
        ..Stroke::default()
    }
}

/// lucide の file-archive。24 × 24 の枠に描く。
fn file() -> Option<Path> {
    let mut pb = PathBuilder::new();
    pb.move_to(13.659, 22.);
    pb.line_to(18., 22.);
    pb.cubic_to(19.105, 22., 20., 21.105, 20., 20.);
    pb.line_to(20., 8.);
    pb.cubic_to(20., 7.364, 19.744, 6.744, 19.294, 6.294);
    pb.line_to(15.706, 2.706);
    pb.cubic_to(15.256, 2.256, 14.636, 2., 14., 2.);
    pb.line_to(6., 2.);
    pb.cubic_to(4.895, 2., 4., 2.895, 4., 4.);
    pb.line_to(4., 15.5);

    pb.move_to(14., 2.);
    pb.line_to(14., 7.);
    pb.cubic_to(14., 7.552, 14.448, 8., 15., 8.);
    pb.line_to(20., 8.);

    for (from, to) in [(12., 11.), (18., 16.), (7., 6.)] {
        pb.move_to(8., from);
        pb.line_to(8., to);
    }
    pb.push_circle(8., 20., 2.);
    pb.finish()
}

/// フォントサイズを 1 とした枠で、x = 0 を中央にそろえた文字列。
fn letters(label: &str) -> Option<Path> {
    let count = label.chars().count() as f32;
    let mut x = -(count * LETTER_WIDTH + (count - 1.) * LETTER_GAP) / 2.;
    let mut pb = PathBuilder::new();
    for c in label.chars() {
        for strokes in glyph(c) {
            let at =
                |(px, py): (f32, f32)| (x + px * LETTER_WIDTH, LETTER_TOP + py * LETTER_HEIGHT);
            let (mx, my) = at(strokes[0]);
            pb.move_to(mx, my);
            for &p in &strokes[1..] {
                let (lx, ly) = at(p);
                pb.line_to(lx, ly);
            }
        }
        x += LETTER_WIDTH + LETTER_GAP;
    }
    pb.finish()
}

/// 幅 edge の PNG。label には glyph にある字のみを使う。
pub fn draw(label: &str, edge: u32) -> Result<Vec<u8>, String> {
    let edge = edge.max(16);
    let height = (edge as f32 / RATIO).round() as u32;
    let mut pm = Pixmap::new(edge, height).ok_or("サムネイルの大きさが不正です")?;
    let (w, h) = (edge as f32, height as f32);
    let size = (h * ICON).round();
    let font = (h * FONT).round();
    let gap = (h * GAP).round();
    let top = ((h - size - gap - font) / 2.).round();
    let paint = gray();
    if let Some(p) = file() {
        let scale = size / 24.;
        let to = Transform::from_scale(scale, scale).post_translate((w - size) / 2., top);
        pm.stroke_path(&p, &paint, &line(1.5), to, None);
    }
    if let Some(p) = letters(label) {
        let to = Transform::from_scale(font, font).post_translate(w / 2., top + size + gap);
        pm.stroke_path(&p, &paint, &line(LETTER_LINE), to, None);
    }
    pm.encode_png().map_err(|e| e.to_string())
}
