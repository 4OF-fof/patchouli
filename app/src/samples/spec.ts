/*
 * 見本の中身の定義。画面の見本（library.ts）と、動作確認用のライブラリ（example/dev-library/）を書き出すスクリプト
 * （scripts/dev-library.ts）の両方がここから作る。負荷を調べるための大きなライブラリ（example/stress-library/）の
 * 中身も、ここで決める。スクリプトは Node が TS をそのまま読むので、ここでは型のほかは何も import しない。
 */
import type { CoverPart, Group, Item, Project, Suggestion, TagCoverPart } from '../model/library'

export const TODAY = new Date(2026, 9, 22, 12)

export const PINNED_PROJECTS = ['秋の企画', '日記']
export const PINNED_TAGS = ['写真', 'UI', '参考']

export type Media = 'image' | 'video' | 'audio' | 'note' | 'link' | 'other'

export const EXAMPLE_PLUGINS: string[] = [
  'example_page-plugin',
  'example_collect-plugin',
  'example_graph-plugin',
  'example_autolink-plugin',
]

export type SpecItem = Item & {
  media: Media
  size?: [number, number]
  sec?: number
  jacket?: boolean
  /** 詳細画面などの負荷を見るための、重い中身にする。動画はフレームレート、音声はサンプリング周波数を持つ */
  heavy?: { fps?: number; rate?: number }
  /** ショートカットが指す URL */
  link?: string
}

export interface Spec {
  items: SpecItem[]
  projects: Project[]
  groups: Group[]
  tagCovers: Map<string, TagCoverPart[]>
  pins: string[]
  pinnedProjects: string[]
  pinnedTags: string[]
}

const MEDIA_OF: Record<string, Media> = {
  jpg: 'image',
  png: 'image',
  webp: 'image',
  mp4: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  url: 'link',
  // アプリもプラグインも読めない（開くと、対応するプラグインがないことを出す）
  psd: 'other',
}

/** id は書き出すときに振る。 */
type RawCard<C> = C extends unknown ? Omit<C, 'id'> : never

const TAG_COVERS: Record<string, RawCard<TagCoverPart>[]> = {
  写真: [
    { type: 'desc', text: 'カメラで撮ったもの。旅行や街は下の階層に分ける。' },
    { type: 'kids' },
    { type: 'exts' },
    { type: 'together' },
  ],
  UI: [{ type: 'kids' }, { type: 'exts' }],
}

type RawBlock = ['p' | 'h2' | 'li', string]
type RawAsset = [name: string, ext: string, tags: string[], moved: number]
type RawNote = [name: string, moved: number, tags: string[], blocks: RawBlock[]]

const PROJECTS: (Omit<Project, 'cover'> & { cover: RawCard<CoverPart>[]; pinNames: string[] })[] = [
  {
    name: '秋の企画',
    hue: 28,
    touched: '今日 09:40',
    cover: [
      { type: 'desc', text: '11 月のポスターと告知用の画像をつくる。彩度を落としたセージと、差し色の朱。' },
      {
        type: 'todo',
        items: [
          { t: '配色を決める', ref: '配色メモ：秋の企画', done: true, due: '2026-10-20' },
          { t: '写真を 8 枚に絞る', done: false, due: '2026-10-21' },
          { t: 'ポスターの下書き', ref: 'poster-draft', done: false, due: '2026-11-15' },
        ],
      },
      { type: 'links', items: [{ t: '印刷所の入稿ルール', u: 'https://example.com/' }] },
    ],
    pinNames: ['配色メモ：秋の企画', '秋の企画：進め方', 'moodboard-01', 'poster-draft'],
  },
  {
    name: 'UI 改善',
    hue: 212,
    touched: '昨日',
    cover: [
      { type: 'desc', text: '一覧の密度を下げ、読む画面と片付ける画面を分ける。' },
      {
        type: 'todo',
        items: [
          { t: '紙面の一面を決める', done: true },
          { t: '分類の確認画面', done: false },
          { t: 'button-states の整理', ref: 'button-states', done: false },
        ],
      },
    ],
    pinNames: ['UI 案レビュー', 'ui-sketch-v3'],
  },
  {
    name: '旅行 2026',
    hue: 118,
    touched: '3 日前',
    cover: [{ type: 'desc', text: '春の旅行の写真から、展示用に 8 枚を選ぶ。' }],
    pinNames: ['旅行写真の選定'],
  },
  {
    name: 'インタビュー',
    hue: 172,
    touched: '10/5',
    cover: [
      { type: 'desc', text: '工房への取材。12 月の公開に向けて編集する。' },
      {
        type: 'todo',
        items: [
          { t: '書き起こし', done: true },
          { t: '公開用に編集する', done: false, due: '2026-12-01' },
        ],
      },
    ],
    pinNames: ['インタビュー構成'],
  },
  {
    name: '資料',
    hue: 36,
    touched: '9/30',
    cover: [{ type: 'desc', text: '本や Web から集めた参考。' }],
    pinNames: [],
  },
  { name: '日記', hue: 262, touched: '今日', cover: [], pinNames: [] },
  {
    name: '2025 春の企画',
    hue: 18,
    touched: '2025/5/10',
    cover: [{ type: 'desc', text: '去年の春の告知。' }],
    pinNames: [],
  },
]

/** ノートで使える書き方をひととおり並べたノート。ほかの見本の id をずらさないよう、最後に足す。 */
const SHOWCASE = [
  'ノートで使える Markdown の書き方を、ひととおり並べた見本。',
  '',
  '# 見出し 1',
  '',
  '## 見出し 2',
  '',
  '### 見出し 3',
  '',
  '#### 見出し 4',
  '',
  '##### 見出し 5',
  '',
  '###### 見出し 6',
  '',
  '下線で書く見出し 1',
  '===',
  '',
  '下線で書く見出し 2',
  '---',
  '',
  '## 文字の書式',
  '',
  '**太字**、*斜体*、~~取り消し線~~、`コード`。**太字の中に *斜体* を入れる**こともできる。',
  '記号をそのまま書くときは \\*エスケープ\\* する。',
  '',
  '## リンク',
  '',
  '素材へのリンクは [[moodboard-01]]、ノートへのリンクは [[配色メモ：秋の企画]]。',
  'リンク先がないときは [[消えた素材]] のように見える。',
  '外のリンクは [例のサイト](https://example.com)、URL だけなら <https://example.com>。',
  '',
  '## 埋め込み',
  '',
  '![[leaf-macro]]',
  '',
  '![[prototype-walk]]',
  '',
  '![[ambient-rain]]',
  '',
  'ショートカットも埋め込める。',
  '',
  '![[Big Buck Bunny]]',
  '',
  'URL をそのまま埋め込むと、ページの OGP をカードにする。',
  '',
  '![](https://github.com/tauri-apps/tauri)',
  '',
  '## 箇条書き',
  '',
  '- りんご',
  '- みかん',
  '  - 温州',
  '  - 伊予柑',
  '- ぶどう',
  '',
  '1. 下書き',
  '2. 見直し',
  '3. 入稿',
  '',
  '- [ ] 配色を決める',
  '- [x] 写真を集める',
  '',
  '## 引用',
  '',
  '> 引用はこう書く。',
  '> 2 行目も続く。',
  '',
  '## 区切り線',
  '',
  '---',
  '',
  '## 表',
  '',
  '| 項目 | 色 | 備考 |',
  '| :--- | :---: | ---: |',
  '| 基調 | セージ | 彩度を落とす |',
  '| 差し色 | 朱 | 一点だけ |',
  '| 明るさ | $L \\approx 0.7$ | 式も書ける |',
  '',
  '## コード',
  '',
  '```ts',
  '// 色相を回して、次の色を返す',
  'export function nextHue(hue: number, step = 30): number {',
  '  const label = `h${hue}`',
  '  return (hue + step) % 360',
  '}',
  '```',
  '',
  '```rust',
  '#[derive(Debug)]',
  'struct Swatch {',
  '    name: String,',
  '    hue: u16,',
  '}',
  '',
  'fn main() {',
  '    let s = Swatch { name: "セージ".into(), hue: 120 };',
  '    println!("{s:?}");',
  '}',
  '```',
  '',
  '    インデントで書くコード',
  '',
  '## 数式',
  '',
  '文中の式は $e^{i\\pi} + 1 = 0$ のように書く。値段の $5 や $10 は式にならない。',
  '',
  '$$',
  '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  '$$',
  '',
  '```math',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  '```',
  '',
  '## 図',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[下書き] --> B[見直し] --> C[入稿]',
  '```',
  '',
].join('\n')

/** [プロジェクト（ライブラリ直下なら null）, 上からのグループの並び, 入れる項目の名前] */
const GROUPS: [project: string | null, path: string[], names: string[]][] = [
  ['秋の企画', ['写真'], ['IMG_2041', 'IMG_2042', 'IMG_2043', 'IMG_2044', 'IMG_2045', 'leaf-macro']],
  ['秋の企画', ['写真', 'ボツ'], ['IMG_2046']],
  ['秋の企画', ['配色'], ['sage-swatch', 'vermilion-dot', 'paper-tone', 'palette-autumn', '配色ガイド']],
  ['旅行 2026', ['動画'], ['train-pass', 'station-vertical']],
  ['旅行 2026', ['メモ'], ['撮影リスト']],
  [null, ['参考'], ['ref-a', 'ref-b']],
  [null, ['参考', '本'], []],
]

const CONTENTS: Record<string, { a: RawAsset[]; n: RawNote[] }> = {
  秋の企画: {
    a: [
      ['moodboard-01', 'jpg', ['配色'], 0],
      ['IMG_2041', 'jpg', ['写真'], 0],
      ['leaf-macro', 'jpg', ['写真'], 1],
      ['sage-swatch', 'png', ['配色'], 1],
      ['vermilion-dot', 'png', ['配色'], 2],
      ['poster-draft', 'png', ['配色'], 2],
      ['texture_paper', 'jpg', ['写真', '参考'], 3],
      ['IMG_2042', 'jpg', ['写真'], 4],
      ['IMG_2043', 'jpg', ['写真'], 4],
      ['IMG_2044', 'jpg', ['写真'], 5],
      ['paper-tone', 'png', ['配色'], 6],
      ['palette-autumn', 'webp', ['配色'], 9],
      ['IMG_2045', 'jpg', ['写真'], 12],
      ['IMG_2046', 'jpg', [], 12],
      ['ambient-rain', 'wav', ['音'], 14],
      ['秋_poster', 'png', ['配色'], 20],
    ],
    n: [
      [
        '配色メモ：秋の企画',
        0,
        ['配色'],
        [
          [
            'p',
            '彩度を落としたセージを基調に、差し色として朱を一点だけ使う。参考は [[moodboard-01]] と [[texture_paper]]。',
          ],
          ['h2', '紙の質感'],
          ['p', '紙の質感はテクスチャで出す。写真素材の色温度は揃える。候補は [[leaf-macro]] と [[paper-tone]]。'],
          ['h2', '差し色'],
          ['p', '差し色は [[vermilion-dot]] が近い。比較は [[差し色の比較]] に書く。'],
          ['li', '[[配色ガイド]] に結果を戻す'],
          ['li', 'ポスターは [[ポスター構成]] で進める'],
        ],
      ],
      [
        '秋の企画：進め方',
        1,
        [],
        [
          ['p', '10 月中に配色を決め、11 月にポスターの下書きをつくる。'],
          ['h2', '段取り'],
          ['li', '配色：[[配色メモ：秋の企画]]'],
          ['li', '写真：[[IMG_2041]] ほかから 8 枚'],
          ['li', '下書き：[[poster-draft]]'],
        ],
      ],
      [
        'ポスター構成',
        3,
        [],
        [
          ['p', '縦長。上 1/3 に写真、下に告知文。'],
          ['p', '下敷きは [[poster-draft]]、配色は [[秋_poster]]。'],
        ],
      ],
      [
        '配色ガイド',
        21,
        ['配色'],
        [
          ['p', '基本の 3 色：[[sage-swatch]]、[[paper-tone]]、[[vermilion-dot]]。'],
          ['p', '季節ごとの差分は [[palette-autumn]]。'],
        ],
      ],
    ],
  },
  'UI 改善': {
    a: [
      ['ui-sketch-v3', 'png', ['UI'], 1],
      ['screenshot-0918', 'png', ['UI'], 6],
      ['wireframe-a', 'png', ['UI'], 8],
      ['wireframe-b', 'png', ['UI'], 8],
      ['logo-master', 'png', ['UI'], 30],
      ['icon-set-04', 'png', ['UI/部品'], 44],
      ['button-states', 'png', ['UI/部品'], 15],
      ['card-layout', 'png', ['UI'], 10],
      ['nav-draft', 'webp', [], 26],
      ['modal-spec', 'png', ['UI'], 70],
      ['prototype-walk', 'mp4', ['UI', '動画'], 5],
    ],
    n: [
      [
        'UI 案レビュー',
        1,
        ['UI'],
        [
          ['p', '一覧の密度を下げる案を 3 つ比較。紙面型が有力。'],
          ['p', '[[ui-sketch-v3]] と [[wireframe-a]]、[[card-layout]] を並べて見る。動きは [[prototype-walk]]。'],
          ['h2', '次にやること'],
          ['li', '[[button-states]] を整理する'],
        ],
      ],
      ['ロゴ改訂', 44, ['UI'], [['p', '[[logo-master]] を基に、旧版との差を小さくする。']]],
    ],
  },
  '旅行 2026': {
    a: [
      ['market-photo', 'jpg', ['写真/旅行'], 2],
      ['river-dusk', 'jpg', ['写真/旅行'], 3],
      ['window-light', 'jpg', ['写真/旅行'], 3],
      ['stone-wall', 'jpg', ['写真/街'], 18],
      ['portrait-03', 'jpg', ['写真/人物'], 40],
      ['IMG_1988', 'jpg', ['写真/旅行'], 60],
      ['IMG_1990', 'jpg', ['写真/旅行'], 60],
      ['IMG_1994', 'jpg', ['写真/旅行'], 61],
      ['IMG_1995', 'jpg', [], 61],
      ['IMG_1996', 'jpg', ['写真/旅行'], 61],
      ['train-pass', 'mp4', ['動画'], 62],
      ['station-vertical', 'mp4', ['動画', '写真/旅行'], 62],
    ],
    n: [
      [
        '旅行写真の選定',
        3,
        ['写真/旅行'],
        [
          ['p', '候補 24 枚から 8 枚に絞る。色温度を揃えてから並べる。'],
          ['p', '残す候補：[[market-photo]]、[[river-dusk]]、[[window-light]]。'],
        ],
      ],
      [
        '撮影リスト',
        27,
        ['写真/旅行'],
        [
          ['li', '[[window-light]] の続き'],
          ['li', '[[stone-wall]] を晴れた日に'],
          ['li', '人物は 11 月'],
        ],
      ],
    ],
  },
  インタビュー: {
    a: [
      ['interview-cut', 'mp4', ['動画'], 17],
      ['b-roll-street', 'mp4', ['動画'], 17],
      ['timelapse-sky', 'webm', ['動画'], 33],
      ['hands-craft', 'mp4', ['動画'], 33],
      ['memo-voice-03', 'flac', ['音'], 17],
      ['interview-audio-2', 'wav', ['音'], 18],
      ['cafe-noise', 'mp3', ['音'], 50],
    ],
    n: [
      [
        'インタビュー構成',
        17,
        [],
        [
          ['p', '素材：[[interview-cut]]、[[memo-voice-03]]、[[interview-audio-2]]。'],
          ['p', '冒頭は [[b-roll-street]] から入る。'],
        ],
      ],
    ],
  },
  資料: {
    a: [
      ['book-cover-ref', 'jpg', ['参考'], 9],
      ['typesetting-sample', 'png', ['参考'], 9],
      ['web-capture-0921', 'webp', ['参考'], 31],
      ['grid-system', 'png', ['参考'], 31],
      ['magazine-spread', 'jpg', ['参考'], 90],
      ['signage-photo', 'jpg', ['参考', '写真/街'], 120],
      ['印刷所の入稿ルール', 'url', ['参考'], 9],
      ['Tauri のリポジトリ', 'url', ['参考'], 31],
      ['Big Buck Bunny', 'url', ['参考', '動画'], 31],
    ],
    n: [
      [
        '読書メモ',
        9,
        ['参考'],
        [
          ['p', '余白の使い方について。文字組みは [[typesetting-sample]] が分かりやすい。'],
          ['p', '[[book-cover-ref]] の装丁も参考になる。'],
        ],
      ],
      [
        'リファレンス整理の手順',
        12,
        [],
        [
          ['p', '1. 取り込んだら、まずプロジェクトに入れる。'],
          ['p', '2. 迷ったらそのまま置き、分類の確認で決める。'],
          ['p', '参考：[[grid-system]]'],
        ],
      ],
    ],
  },
  '2025 春の企画': {
    a: [
      ['spring-poster', 'png', ['配色'], 200],
      ['spring-flyer', 'jpg', ['配色'], 205],
      ['IMG_0412', 'jpg', ['写真'], 210],
    ],
    n: [],
  },
}

const DAILY = [
  '午前：リファレンス整理。素材を 20 件プロジェクトに入れた。',
  '撮影の段取りを確認。',
  '打ち合わせ。紙面の案を共有した。',
  '色温度を揃える作業の続き。',
  '読書：余白の使い方について。',
  '取り込んだ写真の選別。',
  'UI 案の手直し。',
  'ポスターの文字組みを見直す。',
]

const LOOSE: [name: string, ext: string, moved: number, like: string | null, main: string[]][] = [
  ['IMG_3310', 'jpg', 19, '秋の企画', ['写真', '配色']],
  ['IMG_3311', 'jpg', 19, '秋の企画', ['写真']],
  ['IMG_3312', 'jpg', 19, '秋の企画', ['写真']],
  ['IMG_3313', 'jpg', 19, '秋の企画', ['写真']],
  ['IMG_3314', 'jpg', 19, '秋の企画', ['写真', '配色']],
  ['IMG_3315', 'jpg', 19, '秋の企画', ['写真']],
  ['IMG_3316', 'jpg', 19, '旅行 2026', ['写真/旅行']],
  ['IMG_3317', 'jpg', 19, '旅行 2026', ['写真/旅行']],
  ['IMG_3318', 'jpg', 19, '秋の企画', ['配色']],
  ['IMG_3319', 'jpg', 19, null, ['写真']],
  ['スクリーンショット 2026-10-03 10.12', 'png', 19, 'UI 改善', ['UI']],
  ['スクリーンショット 2026-10-03 10.14', 'png', 19, 'UI 改善', ['UI']],
  ['download (3)', 'webp', 4, null, ['参考', '資料']],
  ['download (4)', 'jpg', 4, null, ['参考']],
  ['image (12)', 'png', 2, '秋の企画', ['配色']],
  ['pasted-image', 'png', 1, 'UI 改善', ['UI']],
  ['scan-0930', 'jpg', 22, null, ['参考', '資料']],
  ['untitled', 'png', 8, null, ['参考']],
  ['photo_1021', 'jpg', 1, '旅行 2026', ['写真/旅行']],
  ['capture', 'png', 6, null, ['UI']],
  ['voice-1019', 'mp3', 3, 'インタビュー', ['音']],
  ['clip-0412', 'mp4', 11, 'インタビュー', ['動画']],
  ['theme-demo', 'mp3', 2, 'インタビュー', ['音']],
]
const TAG_POOL: Record<string, string[]> = {
  秋の企画: ['写真', '配色', '秋', '参考'],
  '旅行 2026': ['写真/旅行', '旅', '参考'],
  'UI 改善': ['UI', '参考', '配色'],
  インタビュー: ['音', '動画', '取材'],
  資料: ['参考', '資料', '写真'],
}

const JACKETS = ['theme-demo']

/** ショートカット（.url）の名前 → 指す URL。YouTube のものは例のプラグイン（example/youtube-plugin）が受け持つ */
const LINKS: Record<string, string> = {
  印刷所の入稿ルール: 'https://example.com/',
  'Tauri のリポジトリ': 'https://github.com/tauri-apps/tauri',
  'Big Buck Bunny': 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
}

const PINNED_ITEMS = ['ref-a', 'IMG_3316']

const charSum = (s: string) => {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i)
  return n
}

function sizeOf(media: Media, ext: string, name: string): [number, number] | undefined {
  const odd = charSum(name) % 3 === 0
  if (media === 'video') return name.includes('vertical') ? [1080, 1920] : [1920, 1080]
  if (media !== 'image') return undefined
  if (/^(IMG_|photo_)/.test(name)) return odd ? [3024, 4032] : [4032, 3024]
  if (/^(screenshot|スクリーンショット|capture|pasted)/.test(name)) return [2880, 1800]
  if (/^(icon-|logo-)/.test(name)) return [1024, 1024]
  if (/^(wireframe|ui-|button-|card-|modal-|nav-)/.test(name)) return [1920, 1200]
  if (/poster|flyer|book-cover|portrait/.test(name)) return [1600, 2263]
  if (ext === 'png') return odd ? [1200, 1200] : [1600, 1000]
  return odd ? [2400, 1600] : [2000, 2000]
}

const secOf = (media: Media, name: string) =>
  media === 'video' || media === 'audio' ? 3 + (charSum(name) % 6) : undefined

const ratioOf = (media: Media, size?: [number, number]) =>
  size ? size[0] / size[1] : media === 'note' ? 0.8 : media === 'video' ? 16 / 9 : media === 'link' ? 1.91 : 1.6

function markdown(raw: RawBlock[]) {
  let body = ''
  let prev = ''
  for (const [type, text] of raw) {
    if (body) body += type === 'li' && prev === 'li' ? '\n' : '\n\n'
    body += type === 'h2' ? `## ${text}` : type === 'li' ? `- ${text}` : text
    prev = type
  }
  return `${body}\n`
}

export function sampleSpec(): Spec {
  let seed = 20261022
  const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646)
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))

  const items: SpecItem[] = []
  const add = (
    it: Omit<SpecItem, 'id' | 'media' | 'note' | 'ratio' | 'memo' | 'ext'> & {
      ext: string
    },
  ) => {
    const media = MEDIA_OF[it.ext] ?? 'note'
    const size = sizeOf(media, it.ext, it.name)
    const sec = secOf(media, it.name)
    const full: SpecItem = {
      ...it,
      id: `i${items.length + 1}`,
      media,
      note: media === 'note',
      ratio: ratioOf(media, size),
      memo: '',
      ...(size && { size }),
      ...(sec && { sec }),
      ...(media === 'audio' && JACKETS.includes(it.name) && { jacket: true }),
      ...(media === 'link' && { link: LINKS[it.name] }),
    }
    items.push(full)
    return full
  }
  const hueOf = new Map(PROJECTS.map((p) => [p.name, p.hue]))

  for (const [pn, s] of Object.entries(CONTENTS)) {
    const h = hueOf.get(pn) ?? 0
    for (const [name, ext, tags, moved] of s.a) {
      const hue = h + ri(-20, 20)
      add({ name, ext, tags: [...tags], project: pn, group: null, moved, hue, sat: ri(14, 30) })
    }
    for (const [name, moved, tags, raw] of s.n) {
      add({
        name,
        ext: 'md',
        project: pn,
        group: null,
        tags,
        moved,
        hue: h,
        sat: 16,
        body: markdown(raw),
        aliases: name === '配色メモ：秋の企画' ? ['秋の配色'] : [],
      })
    }
  }

  const linkable = items.filter((i) => !i.note)
  const pick = () => linkable[Math.floor(rnd() * linkable.length)]?.name ?? ''
  for (let d = 0; d < 30; d++) {
    if (d % 5 === 3) continue
    const t = new Date(TODAY.getTime() - d * 864e5)
    const name = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    const raw: RawBlock[] = [['p', DAILY[(d * 3) % DAILY.length] ?? '']]
    if (d % 2 === 0) raw.push(['p', `候補：[[${pick()}]]、[[${pick()}]]。`])
    add({
      name,
      ext: 'md',
      project: '日記',
      group: null,
      tags: [],
      moved: d,
      hue: 262,
      sat: 14,
      body: markdown(raw),
      aliases: [],
    })
  }

  let order = 0
  const suggest = (like: string | null, main: string[]): Suggestion => {
    const conf = rnd() < 0.72 ? '類似度：高' : '類似度：中'
    const tags = main.map((tag, i) => ({ tag, conf: i === 0 ? conf : '類似度：中', on: true }))
    for (const tag of (like && TAG_POOL[like]) || ['参考', '写真', '配色'])
      if (tags.length < 4 && !tags.some((x) => x.tag === tag))
        tags.push({ tag, conf: tags.length < 3 ? '類似度：中' : '類似度：低', on: false })
    return { tags, order: order++ }
  }
  for (const [name, ext, moved, like, main] of LOOSE) {
    const base = like ? (hueOf.get(like) ?? 40) : 40
    const hue = base + ri(-14, 14)
    const it = add({ name, ext, tags: [], project: null, group: null, moved, hue, sat: ri(10, 24) })
    it.suggestion = suggest(like, main)
  }
  add({ name: 'ref-a', ext: 'jpg', tags: ['参考'], project: null, group: null, moved: 26, hue: 40, sat: 18 })
  add({ name: 'ref-b', ext: 'jpg', tags: ['参考'], project: null, group: null, moved: 26, hue: 44, sat: 18 })
  add({ name: 'ポスター案', ext: 'psd', tags: [], project: '秋の企画', group: null, moved: 3, hue: 28, sat: 20 })
  add({
    name: '記法の見本',
    ext: 'md',
    tags: [],
    project: '資料',
    group: null,
    moved: 0,
    hue: 36,
    sat: 16,
    body: SHOWCASE,
    aliases: [],
  })

  const byName = new Map(items.map((i) => [i.name, i]))
  const groups: Group[] = []
  for (const [project, path, names] of GROUPS) {
    let parent: Group | undefined
    for (const name of path) {
      const pid = parent?.id ?? null
      let g = groups.find((x) => x.name === name && x.project === project && x.parent === pid)
      if (!g) {
        g = { id: `g${groups.length + 1}`, name, project, parent: pid, touched: '今日', mtime: TODAY.getTime() }
        groups.push(g)
      }
      parent = g
    }
    for (const n of names) {
      const it = byName.get(n)
      if (it && parent) it.group = parent.id
    }
  }
  linkByName(items, byName)
  const withId = cardIds()
  const projects = PROJECTS.map((p) => projectOf(p, withId, byName))
  const tagCovers = new Map(Object.entries(TAG_COVERS).map(([t, c]) => [t, c.map(withId) as TagCoverPart[]]))
  const pins = [...PROJECTS.flatMap((p) => p.pinNames), ...PINNED_ITEMS].flatMap((n) => byName.get(n)?.id ?? [])
  return { items, projects, groups, tagCovers, pins, pinnedProjects: PINNED_PROJECTS, pinnedTags: PINNED_TAGS }
}

/** 見本では [[名前]] で書き、ファイルの形の [名前](patchouli:ID) に直す。ない名前は、リンク切れの見本として使う */
function linkByName(items: SpecItem[], byName: Map<string, SpecItem>) {
  let lost = 0
  const lostId = new Map<string, string>()
  for (const it of items)
    it.body = it.body?.replace(/\[\[([^\]]+)\]\]/g, (_, name: string) => {
      const id = byName.get(name)?.id ?? lostId.get(name) ?? `lost${++lost}`
      if (!byName.has(name)) lostId.set(name, id)
      return `[${name}](patchouli:${id})`
    })
}

/** 中身のあるカードには c1, c2… を、中身のないカードには種類をそのまま id に振る */
function cardIds() {
  let card = 0
  return <C extends { type: string }>(c: C) => ({
    ...structuredClone(c),
    id: 'text' in c || 'items' in c ? `c${++card}` : c.type,
  })
}

/** タスクの参照も名前で書き、素材の id に直す */
function projectOf(
  { name, hue, touched, cover }: Omit<Project, 'cover'> & { cover: RawCard<CoverPart>[] },
  withId: ReturnType<typeof cardIds>,
  byName: Map<string, SpecItem>,
): Project {
  return {
    name,
    hue,
    touched,
    cover: cover
      .map(withId)
      .map((c) =>
        c.type === 'todo' ? { ...c, items: c.items.map((x) => (x.ref ? { ...x, ref: byName.get(x.ref)?.id } : x)) } : c,
      ),
  }
}

/** 負荷を調べるためのライブラリの項目の数 */
export const STRESS_ITEMS = 30000

const STRESS_TOPICS = [
  '写真',
  'UI',
  '参考',
  '配色',
  '音',
  '動画',
  '資料',
  '人物',
  '街',
  '旅行',
  '食べ物',
  '建築',
  '植物',
  '空',
  '夜景',
  '文字',
  'ロゴ',
  '紙',
  '布',
  '光',
  '動物',
  '乗り物',
  '道具',
  '季節',
  'イベント',
  '仕事',
  '趣味',
  '家',
  '海',
  '山',
]
const STRESS_SUBTAGS = ['案', '完成', '没', '候補', '比較', '古い', '新しい', 'A', 'B', '部品']
const STRESS_THEMES = ['ポスター', '告知', 'サイト改修', '撮影', '取材', '展示', '冊子', 'ロゴ', '資料集め', '動画編集']
const STRESS_GROUP_NAMES = ['素材', '下書き', '書き出し', '没', '候補', '参考', '比較', '完成', '古い版', '撮影']

/** [名前の頭, 拡張子, 大きさ]。絵は大きさと拡張子ごとに 1 枚ずつ作り、同じものを複製する */
const STRESS_IMAGES: [prefix: string, ext: string, size: [number, number]][] = [
  ['IMG_', 'jpg', [4032, 3024]],
  ['IMG_', 'jpg', [3024, 4032]],
  ['スクリーンショット ', 'png', [2880, 1800]],
  ['ui-', 'png', [1920, 1200]],
  ['icon-', 'png', [1024, 1024]],
  ['poster-', 'jpg', [1600, 2263]],
  ['photo_', 'jpg', [2400, 1600]],
  ['download (', 'webp', [2000, 2000]],
  ['web-capture-', 'webp', [1280, 4000]],
  ['thumb-', 'jpg', [640, 480]],
]
const STRESS_VIDEOS: [prefix: string, ext: string, size: [number, number], sec: number][] = [
  ['clip-', 'mp4', [1920, 1080], 10],
  ['vertical-', 'mp4', [1080, 1920], 8],
  ['loop-', 'webm', [1280, 720], 6],
]
const STRESS_AUDIOS: [prefix: string, ext: string, sec: number, jacket: boolean][] = [
  ['voice-', 'mp3', 30, false],
  ['take-', 'wav', 10, false],
  ['master-', 'flac', 20, false],
  ['track-', 'mp3', 30, true],
]

const STRESS_SENTENCES = [
  '午前はリファレンスの整理をした。',
  '色温度を揃えてから並べ直す。',
  '打ち合わせで紙面の案を共有した。',
  '余白の使い方を見直したい。',
  '候補を 3 つに絞り、比較の表を作る。',
  '撮影の段取りを確認する。',
  '文字組みは本文を優先して決める。',
  '差し色は一点だけにする。',
  '素材の書き出しの大きさを揃える。',
  '次の打ち合わせまでに下書きを用意する。',
]

/** 詳細画面などの負荷を見るための、大きい素材 */
const STRESS_HEAVY: Omit<SpecItem, 'id' | 'note' | 'ratio' | 'memo' | 'project' | 'group' | 'moved' | 'hue' | 'sat'>[] =
  [
    {
      name: 'heavy-4k60',
      ext: 'mp4',
      media: 'video',
      tags: ['動画'],
      size: [3840, 2160],
      sec: 180,
      heavy: { fps: 60 },
    },
    { name: 'heavy-1h', ext: 'mp4', media: 'video', tags: ['動画'], size: [1920, 1080], sec: 3600, heavy: { fps: 30 } },
    {
      name: 'heavy-vp9',
      ext: 'webm',
      media: 'video',
      tags: ['動画'],
      size: [2560, 1440],
      sec: 300,
      heavy: { fps: 30 },
    },
    { name: 'heavy-2h', ext: 'mp3', media: 'audio', tags: ['音'], sec: 7200, heavy: { rate: 44100 } },
    { name: 'heavy-96k', ext: 'flac', media: 'audio', tags: ['音'], sec: 3600, heavy: { rate: 96000 } },
    { name: 'heavy-wav', ext: 'wav', media: 'audio', tags: ['音'], sec: 1800, heavy: { rate: 48000 } },
    { name: 'heavy-jacket', ext: 'mp3', media: 'audio', tags: ['音'], sec: 600, jacket: true, heavy: { rate: 44100 } },
    { name: 'heavy-12k', ext: 'png', media: 'image', tags: ['写真'], size: [12000, 8000], heavy: {} },
    { name: 'heavy-8k', ext: 'jpg', media: 'image', tags: ['写真'], size: [8000, 6000], heavy: {} },
    { name: 'heavy-tall', ext: 'webp', media: 'image', tags: ['写真'], size: [2000, 16000], heavy: {} },
  ]

/**
 * 負荷を調べるためのライブラリ。STRESS_ITEMS 件の項目を、プロジェクトとグループの深い階層と、多くのタグに散らす。
 * 項目の多くは数種類の絵の複製で、大きい素材と重いノートは「重い素材」のプロジェクトにまとめる。
 */
export function stressSpec(): Spec {
  let seed = 30000
  const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646)
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]
  const recent = (max: number) => Math.floor(rnd() ** 2 * max)

  const tags = STRESS_TOPICS.flatMap((t, i) => [t, ...STRESS_SUBTAGS.slice(0, i % 11).map((s) => `${t}/${s}`)])
  const tagsOf = () => Array.from(new Set(Array.from({ length: Math.floor(rnd() ** 1.5 * 6) }, () => pick(tags))))

  const HEAVY = '重い素材'
  const DIARY = '日記'
  const names = [
    HEAVY,
    DIARY,
    ...Array.from(
      { length: 38 },
      (_, i) => `${STRESS_THEMES[i % STRESS_THEMES.length]} ${2023 + Math.floor(i / STRESS_THEMES.length)}`,
    ),
  ]
  const raw = names.map((name, i) => ({
    name,
    hue: (i * 37) % 360,
    touched: '今日',
    cover: [
      { type: 'desc' as const, text: `${name}の素材とメモ。` },
      {
        type: 'todo' as const,
        items: Array.from({ length: i === 0 ? 200 : ri(0, 12) }, (_, j) => ({
          t: `${pick(STRESS_SENTENCES)}（${j + 1}）`,
          done: rnd() < 0.5,
        })),
      },
      {
        type: 'links' as const,
        items: Array.from({ length: ri(0, 4) }, (_, j) => ({ t: `参考 ${j + 1}`, u: 'https://example.com/' })),
      },
    ],
  }))

  // プロジェクトごとに 3 段までのグループを作る。ライブラリ直下にもいくつか置く
  const groups: Group[] = []
  const addGroup = (project: string | null, parent: string | null, depth: number) => {
    const used = new Set(groups.filter((g) => g.project === project && g.parent === parent).map((g) => g.name))
    let name = pick(STRESS_GROUP_NAMES)
    for (let n = 2; used.has(name); n++) name = `${pick(STRESS_GROUP_NAMES)} ${n}`
    const g: Group = { id: `g${groups.length + 1}`, name, project, parent, touched: '今日', mtime: TODAY.getTime() }
    groups.push(g)
    const kids = depth < 2 ? ri(0, 4 - depth * 2) : 0
    for (let k = 0; k < kids; k++) addGroup(project, g.id, depth + 1)
  }
  for (const p of names.slice(2)) for (let k = ri(0, 6); k > 0; k--) addGroup(p, null, 0)
  for (let k = 0; k < 5; k++) addGroup(null, null, 1)

  // 前のほうのプロジェクトほど項目を多くし、ひとつのプロジェクトに数千件が集まるようにする
  const place = (): Pick<Item, 'project' | 'group'> => {
    const r = rnd()
    if (r < 0.08) return { project: null, group: null }
    if (r < 0.12) return { project: null, group: pick(groups.filter((g) => !g.project)).id }
    const project = names[2 + Math.floor(rnd() ** 2.5 * (names.length - 2))] ?? null
    const inside = groups.filter((g) => g.project === project)
    return { project, group: inside.length && rnd() < 0.6 ? pick(inside).id : null }
  }

  const items: SpecItem[] = []
  const add = (it: Omit<SpecItem, 'id' | 'note' | 'ratio' | 'memo'>) => {
    const full: SpecItem = {
      ...it,
      id: `i${items.length + 1}`,
      note: it.media === 'note',
      ratio: ratioOf(it.media, it.size),
      memo: '',
    }
    items.push(full)
    return full
  }
  const hueOf = new Map(raw.map((p) => [p.name, p.hue]))
  const colored = (where: Pick<Item, 'project' | 'group'>) => ({
    ...where,
    hue: ((where.project ? (hueOf.get(where.project) ?? 40) : 40) + ri(-20, 20) + 360) % 360,
    sat: ri(10, 30),
  })

  for (const h of STRESS_HEAVY) add({ ...h, tags: [...h.tags], project: HEAVY, group: null, moved: 0, hue: 0, sat: 20 })

  const daily = 730
  const notes = 3000
  const assets = STRESS_ITEMS - items.length - notes
  for (let n = 0; n < assets; n++) {
    const where = colored(place())
    const base = { ...where, tags: tagsOf(), moved: recent(1500) }
    const r = rnd()
    if (r < 0.012) {
      const [prefix, ext, size, sec] = pick(STRESS_VIDEOS)
      add({ ...base, name: `${prefix}${n + 1}`, ext, media: 'video', size, sec })
    } else if (r < 0.024) {
      const [prefix, ext, sec, jacket] = pick(STRESS_AUDIOS)
      add({ ...base, name: `${prefix}${n + 1}`, ext, media: 'audio', sec, ...(jacket && { jacket }) })
    } else if (r < 0.028) {
      add({ ...base, name: `layered-${n + 1}`, ext: 'psd', media: 'other' })
    } else {
      const [prefix, ext, size] = pick(STRESS_IMAGES)
      add({ ...base, name: `${prefix}${n + 1}${prefix.endsWith('(') ? ')' : ''}`, ext, media: 'image', size })
    }
  }

  const linkable = items.filter((i) => !i.note && !i.heavy)
  const paragraph = (links: number) =>
    [
      ...Array.from({ length: ri(1, 3) }, () => pick(STRESS_SENTENCES)),
      ...Array.from({ length: links }, () => `[[${pick(linkable).name}]]`),
    ].join('')
  const body = (blocks: number) =>
    `${Array.from({ length: blocks }, (_, b) =>
      b % 7 === 6 ? `## 見出し ${b}` : b % 5 === 4 ? `- ${paragraph(rnd() < 0.3 ? 1 : 0)}` : paragraph(ri(0, 2)),
    ).join('\n\n')}\n`
  const note = (name: string, where: Pick<Item, 'project' | 'group'>, moved: number, text: string) =>
    add({ ...colored(where), name, ext: 'md', media: 'note', tags: tagsOf(), moved, body: text, aliases: [] })

  for (let d = 0; d < daily; d++) {
    const t = new Date(TODAY.getTime() - d * 864e5)
    const name = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    note(name, { project: DIARY, group: null }, d, body(ri(1, 6)))
  }
  note('長いノート', { project: HEAVY, group: null }, 0, body(20000))
  note(
    'リンクの多いノート',
    { project: HEAVY, group: null },
    0,
    `${Array.from({ length: 3000 }, () => `- [[${pick(linkable).name}]]`).join('\n')}\n`,
  )
  note(
    '埋め込みの多いノート',
    { project: HEAVY, group: null },
    0,
    `${Array.from({ length: 300 }, (_, k) => `![[${pick(linkable).name}]]\n\n埋め込み ${k + 1}`).join('\n\n')}\n`,
  )
  while (items.length < STRESS_ITEMS)
    note(`メモ ${items.length + 1}`, place(), recent(1500), body(rnd() < 0.1 ? ri(50, 200) : ri(1, 12)))

  const byName = new Map(items.map((i) => [i.name, i]))
  linkByName(items, byName)
  const withId = cardIds()
  const tagCovers = new Map(Object.entries(TAG_COVERS).map(([t, c]) => [t, c.map(withId) as TagCoverPart[]]))
  const pins = Array.from({ length: 30 }, () => pick(items).id)
  return {
    items,
    projects: raw.map((p) => projectOf(p, withId, byName)),
    groups,
    tagCovers,
    pins: [...new Set(pins)],
    pinnedProjects: names.slice(0, 5),
    pinnedTags: STRESS_TOPICS.slice(0, 5),
  }
}
