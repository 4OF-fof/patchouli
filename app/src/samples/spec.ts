/*
 * 見本の中身の定義。画面の見本（library.ts）と、動作確認用のライブラリ（example/dev-library/）を書き出すスクリプト
 * （scripts/dev-library.ts）の両方がここから作る。スクリプトは Node が TS をそのまま読むので、
 * ここでは型のほかは何も import しない。
 */
import type { Item, NoteBlock, Project, Suggestion, TagCoverPart } from '../model/library'

export const TODAY = new Date(2026, 9, 22, 12)

export const PINNED_PROJECTS = ['秋の企画', '日記']
export const PINNED_TAGS = ['写真', 'UI', '参考']

export type Media = 'image' | 'video' | 'audio' | 'text' | 'note' | 'other'

export const EXAMPLE_PLUGINS = ['text-plugin', 'ppm-plugin']

export type SpecItem = Item & {
  media: Media
  size?: [number, number]
  sec?: number
  jacket?: boolean
  text?: string
}

export interface Spec {
  items: SpecItem[]
  projects: Project[]
  tagCovers: Map<string, TagCoverPart[]>
  pins: string[]
}

const MEDIA_OF: Record<string, Media> = {
  jpg: 'image',
  png: 'image',
  webp: 'image',
  // アプリは読めず、例のプラグイン（example/ppm-plugin）が読む
  ppm: 'image',
  // 例のプラグイン（example/text-plugin）が読む
  txt: 'text',
  mp4: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  // アプリもプラグインも読めない（開くと、対応するプラグインがないことを出す）
  psd: 'other',
}

const TAG_COVERS: Record<string, TagCoverPart[]> = {
  写真: [
    { type: 'desc', text: 'カメラで撮ったもの。旅行や街は下の階層に分ける。' },
    { type: 'kids' },
    { type: 'exts' },
    { type: 'together' },
  ],
  UI: [{ type: 'kids' }, { type: 'exts' }],
}

type RawBlock = [NoteBlock['type'], string]
type RawAsset = [name: string, ext: string, tags: string[], moved: number]
type RawNote = [name: string, moved: number, tags: string[], blocks: RawBlock[]]

const PROJECTS: (Project & { pinNames: string[] })[] = [
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
          { t: '整理の承認画面', done: false },
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
  {
    name: 'プラグインの確認',
    hue: 196,
    touched: '今日 11:00',
    cover: [
      {
        type: 'desc',
        text: '例のプラグイン（example/）で読む素材。.txt は組み込み UI、.ppm は宣言型（WASM）で読む。',
      },
    ],
    pinNames: [],
  },
]

const TEXTS: Record<string, string> = {
  読み方: [
    '読み方のメモ',
    '',
    '1 行目',
    '2 行目はとても長い行で、折り返しの設定を確かめるために、ここに長い文章を書いておく。折り返さないときは横に伸びる。',
    '3 行目',
  ].join('\n'),
  changelog: [
    '0.2.0',
    '- 詳細の表示を組み込み UI で描く',
    '- サムネイルを canvas で描く',
    '',
    '0.1.0',
    '- はじめての版',
  ].join('\n'),
}

/** 例のプラグインで読む素材。ほかの見本の id や乱数をずらさないよう、最後に足す。 */
const PLUGIN_ASSETS: RawAsset[] = [
  ['読み方', 'txt', [], 0],
  ['scan-01', 'ppm', ['写真'], 1],
  ['changelog', 'txt', [], 2],
  ['scan-02', 'ppm', [], 3],
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
          ['p', '2. 迷ったらそのまま置き、自動分類の確認でまとめて決める。'],
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
  size ? size[0] / size[1] : media === 'note' || media === 'text' ? 0.8 : media === 'video' ? 16 / 9 : 1.6

const blocks = (raw: RawBlock[]): NoteBlock[] => raw.map(([type, text]) => ({ type, text }))

export function sampleSpec(): Spec {
  let seed = 20261022
  const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646)
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))

  const items: SpecItem[] = []
  const add = (
    it: Omit<SpecItem, 'id' | 'media' | 'note' | 'ratio' | 'rating' | 'memo' | 'ext'> & {
      ext: string
      rating?: number
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
      rating: it.rating ?? 0,
      memo: '',
      ...(size && { size }),
      ...(sec && { sec }),
      ...(media === 'audio' && JACKETS.includes(it.name) && { jacket: true }),
      ...(media === 'text' && { text: TEXTS[it.name] ?? '' }),
    }
    items.push(full)
    return full
  }
  const hueOf = new Map(PROJECTS.map((p) => [p.name, p.hue]))

  for (const [pn, s] of Object.entries(CONTENTS)) {
    const h = hueOf.get(pn) ?? 0
    for (const [name, ext, tags, moved] of s.a) {
      const rating = ri(0, 5)
      const hue = h + ri(-20, 20)
      add({ name, ext, tags: [...tags], folder: pn, rating, moved, hue, sat: ri(14, 30) })
    }
    for (const [name, moved, tags, raw] of s.n) {
      add({
        name,
        ext: 'md',
        folder: pn,
        tags,
        moved,
        hue: h,
        sat: 16,
        blocks: blocks(raw),
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
    add({ name, ext: 'md', folder: '日記', tags: [], moved: d, hue: 262, sat: 14, blocks: blocks(raw), aliases: [] })
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
    const it = add({ name, ext, tags: [], folder: null, moved, hue, sat: ri(10, 24) })
    it.suggestion = suggest(like, main)
  }
  add({ name: 'ref-a', ext: 'jpg', tags: ['参考'], folder: null, moved: 26, hue: 40, sat: 18 })
  add({ name: 'ref-b', ext: 'jpg', tags: ['参考'], folder: null, moved: 26, hue: 44, sat: 18 })
  for (const [name, ext, tags, moved] of PLUGIN_ASSETS)
    add({ name, ext, tags: [...tags], folder: 'プラグインの確認', moved, hue: 196, sat: 20 })
  add({ name: 'ポスター案', ext: 'psd', tags: [], folder: '秋の企画', moved: 3, hue: 28, sat: 20 })

  const byName = new Map(items.map((i) => [i.name, i]))
  const projects: Project[] = PROJECTS.map(({ name, hue, touched, cover }) => ({
    name,
    hue,
    touched,
    cover: structuredClone(cover),
  }))
  const pins = [...PROJECTS.flatMap((p) => p.pinNames), ...PINNED_ITEMS].flatMap((n) => byName.get(n)?.id ?? [])
  return { items, projects, tagCovers: new Map(Object.entries(structuredClone(TAG_COVERS))), pins }
}
