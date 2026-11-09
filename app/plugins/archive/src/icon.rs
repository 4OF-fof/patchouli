//! サムネイルのアイコン。角を折った紙にファスナーと形式の字を描く。座標は辺の長さを 1 とした割合で書く。

use tiny_skia::{
    Color, FillRule, LineCap, LineJoin, Paint, Path, PathBuilder, Pixmap, Rect, Stroke, Transform,
};

const PAPER: (u8, u8, u8) = (0xe6, 0xdc, 0xcb);
const FOLD: (u8, u8, u8) = (0xc8, 0xb8, 0x9f);
const INK: (u8, u8, u8) = (0x6b, 0x5c, 0x4a);

const LEFT: f32 = 0.2;
const RIGHT: f32 = 0.8;
const TOP: f32 = 0.08;
const BOTTOM: f32 = 0.92;
const ROUND: f32 = 0.05;
const CORNER: f32 = 0.16;

const LETTER_TOP: f32 = 0.64;
const LETTER_HEIGHT: f32 = 0.16;
const LETTER_WIDTH: f32 = 0.1;
const LETTER_GAP: f32 = 0.05;

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

fn paint((r, g, b): (u8, u8, u8)) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(Color::from_rgba8(r, g, b, 0xff));
    p.anti_alias = true;
    p
}

fn rect(pb: &mut PathBuilder, x: f32, y: f32, w: f32, h: f32) {
    if let Some(r) = Rect::from_xywh(x, y, w, h) {
        pb.push_rect(r);
    }
}

fn paper() -> Option<Path> {
    let mut pb = PathBuilder::new();
    pb.move_to(LEFT + ROUND, TOP);
    pb.line_to(RIGHT - CORNER, TOP);
    pb.line_to(RIGHT, TOP + CORNER);
    pb.line_to(RIGHT, BOTTOM - ROUND);
    pb.quad_to(RIGHT, BOTTOM, RIGHT - ROUND, BOTTOM);
    pb.line_to(LEFT + ROUND, BOTTOM);
    pb.quad_to(LEFT, BOTTOM, LEFT, BOTTOM - ROUND);
    pb.line_to(LEFT, TOP + ROUND);
    pb.quad_to(LEFT, TOP, LEFT + ROUND, TOP);
    pb.close();
    pb.finish()
}

fn fold() -> Option<Path> {
    let mut pb = PathBuilder::new();
    pb.move_to(RIGHT - CORNER, TOP);
    pb.line_to(RIGHT - CORNER, TOP + CORNER - ROUND);
    pb.quad_to(
        RIGHT - CORNER,
        TOP + CORNER,
        RIGHT - CORNER + ROUND,
        TOP + CORNER,
    );
    pb.line_to(RIGHT, TOP + CORNER);
    pb.close();
    pb.finish()
}

/// 左右に互い違いに並ぶ歯と、引き手。
fn zipper() -> Option<Path> {
    let mut pb = PathBuilder::new();
    for i in 0..6 {
        let x = if i % 2 == 0 { 0.44 } else { 0.5 };
        rect(&mut pb, x, TOP + i as f32 * 0.05, 0.06, 0.035);
    }
    rect(&mut pb, 0.44, 0.38, 0.12, 0.15);
    pb.finish()
}

fn letters(label: &str) -> Option<Path> {
    let count = label.chars().count() as f32;
    let width = count * LETTER_WIDTH + (count - 1.) * LETTER_GAP;
    let mut x = 0.5 - width / 2.;
    let mut pb = PathBuilder::new();
    for c in label.chars() {
        for line in glyph(c) {
            let at =
                |(px, py): (f32, f32)| (x + px * LETTER_WIDTH, LETTER_TOP + py * LETTER_HEIGHT);
            let (mx, my) = at(line[0]);
            pb.move_to(mx, my);
            for &p in &line[1..] {
                let (lx, ly) = at(p);
                pb.line_to(lx, ly);
            }
        }
        x += LETTER_WIDTH + LETTER_GAP;
    }
    pb.finish()
}

/// edge × edge の PNG。label には glyph にある字だけを使う。
pub fn draw(label: &str, edge: u32) -> Result<Vec<u8>, String> {
    let edge = edge.max(16);
    let mut pm = Pixmap::new(edge, edge).ok_or("サムネイルの大きさが不正です")?;
    let to = Transform::from_scale(edge as f32, edge as f32);
    let fill = |pm: &mut Pixmap, path: Option<Path>, color| {
        if let Some(p) = path {
            pm.fill_path(&p, &paint(color), FillRule::Winding, to, None);
        }
    };
    fill(&mut pm, paper(), PAPER);
    fill(&mut pm, fold(), FOLD);
    fill(&mut pm, zipper(), INK);
    let mut hole = PathBuilder::new();
    rect(&mut hole, 0.475, 0.45, 0.05, 0.05);
    fill(&mut pm, hole.finish(), PAPER);
    if let Some(p) = letters(label) {
        let stroke = Stroke {
            width: 0.04,
            line_cap: LineCap::Round,
            line_join: LineJoin::Round,
            ..Stroke::default()
        };
        pm.stroke_path(&p, &paint(INK), &stroke, to, None);
    }
    pm.encode_png().map_err(|e| e.to_string())
}
