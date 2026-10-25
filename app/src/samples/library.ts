/* 画面を確かめるための見本。動くモック（patchouli-mock.html）と同じ中身を、同じ乱数で作る。 */
import {
  buildLibrary,
  type Item,
  type ItemKind,
  type Library,
  type NoteBlock,
  type Project,
  type Suggestion,
} from '../model/library'

/** 見本の「今日」。 */
export const TODAY = new Date(2026, 9, 22, 12)

type RawBlock = [NoteBlock['type'], string]
type RawAsset = [name: string, kind: ItemKind, tags: string[], moved: number]
type RawNote = [name: string, moved: number, tags: string[], blocks: RawBlock[]]

const PROJECTS: (Omit<Project, 'pins'> & { pinNames: string[] })[] = [
  {
    name: '秋の企画',
    hue: 28,
    touched: '今日 09:40',
    cover: [
      { type: 'desc', text: '11 月のポスターと告知用の画像をつくる。彩度を落としたセージと、差し色の朱。' },
      { type: 'due', date: '2026-11-15' },
      {
        type: 'todo',
        items: [
          { t: '配色を決める', ref: '配色メモ：秋の企画', done: true },
          { t: '写真を 8 枚に絞る', done: false },
          { t: 'ポスターの下書き', ref: 'poster-draft', done: false },
        ],
      },
      { type: 'samples', refs: ['moodboard-01', 'sage-swatch', 'vermilion-dot'] },
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
      { type: 'stats' },
    ],
    pinNames: ['UI 案レビュー', 'ui-sketch-v3'],
  },
  {
    name: '旅行 2026',
    hue: 118,
    touched: '3 日前',
    cover: [
      { type: 'desc', text: '春の旅行の写真から、展示用に 8 枚を選ぶ。' },
      { type: 'samples', refs: ['market-photo', 'river-dusk', 'window-light'] },
    ],
    pinNames: ['旅行写真の選定'],
  },
  {
    name: 'インタビュー',
    hue: 172,
    touched: '10/5',
    cover: [
      { type: 'desc', text: '工房への取材。12 月の公開に向けて編集する。' },
      { type: 'due', date: '2026-12-01' },
      { type: 'recent' },
    ],
    pinNames: ['インタビュー構成'],
  },
  {
    name: '資料',
    hue: 36,
    touched: '9/30',
    cover: [{ type: 'desc', text: '本や Web から集めた参考。' }, { type: 'stats' }],
    pinNames: [],
  },
  { name: '日記', hue: 262, touched: '今日', cover: [{ type: 'stats' }, { type: 'recent' }], pinNames: [] },
  {
    name: '2025 春の企画',
    hue: 18,
    touched: '2025/5/10',
    cover: [{ type: 'desc', text: '去年の春の告知。' }],
    pinNames: [],
  },
]

const SPEC: Record<string, { a: RawAsset[]; n: RawNote[] }> = {
  秋の企画: {
    a: [
      ['moodboard-01', 'image', ['配色'], 0],
      ['IMG_2041', 'image', ['写真'], 0],
      ['leaf-macro', 'image', ['写真'], 1],
      ['sage-swatch', 'image', ['配色'], 1],
      ['vermilion-dot', 'image', ['配色'], 2],
      ['poster-draft', 'image', ['配色'], 2],
      ['texture_paper', 'image', ['写真', '参考'], 3],
      ['IMG_2042', 'image', ['写真'], 4],
      ['IMG_2043', 'image', ['写真'], 4],
      ['IMG_2044', 'image', ['写真'], 5],
      ['paper-tone', 'image', ['配色'], 6],
      ['palette-autumn', 'image', ['配色'], 9],
      ['IMG_2045', 'image', ['写真'], 12],
      ['IMG_2046', 'image', [], 12],
      ['ambient-rain', 'audio', ['音'], 14],
      ['秋_poster', 'image', ['配色'], 20],
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
      ['ui-sketch-v3', 'image', ['UI'], 1],
      ['screenshot-0918', 'image', ['UI'], 6],
      ['wireframe-a', 'image', ['UI'], 8],
      ['wireframe-b', 'image', ['UI'], 8],
      ['logo-master', 'image', ['UI'], 30],
      ['icon-set-04', 'image', ['UI/部品'], 44],
      ['button-states', 'image', ['UI/部品'], 15],
      ['card-layout', 'image', ['UI'], 10],
      ['nav-draft', 'image', [], 26],
      ['modal-spec', 'image', ['UI'], 70],
    ],
    n: [
      [
        'UI 案レビュー',
        1,
        ['UI'],
        [
          ['p', '一覧の密度を下げる案を 3 つ比較。紙面型が有力。'],
          ['p', '[[ui-sketch-v3]] と [[wireframe-a]]、[[card-layout]] を並べて見る。'],
          ['h2', '次にやること'],
          ['li', '[[button-states]] を整理する'],
        ],
      ],
      ['ロゴ改訂', 44, ['UI'], [['p', '[[logo-master]] を基に、旧版との差を小さくする。']]],
    ],
  },
  '旅行 2026': {
    a: [
      ['market-photo', 'image', ['写真/旅行'], 2],
      ['river-dusk', 'image', ['写真/旅行'], 3],
      ['window-light', 'image', ['写真/旅行'], 3],
      ['stone-wall', 'image', ['写真/街'], 18],
      ['portrait-03', 'image', ['写真/人物'], 40],
      ['IMG_1988', 'image', ['写真/旅行'], 60],
      ['IMG_1990', 'image', ['写真/旅行'], 60],
      ['IMG_1994', 'image', ['写真/旅行'], 61],
      ['IMG_1995', 'image', [], 61],
      ['IMG_1996', 'image', ['写真/旅行'], 61],
      ['train-pass', 'video', ['動画'], 62],
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
      ['interview-cut', 'video', ['動画'], 17],
      ['b-roll-street', 'video', ['動画'], 17],
      ['timelapse-sky', 'video', ['動画'], 33],
      ['hands-craft', 'video', ['動画'], 33],
      ['memo-voice-03', 'audio', ['音'], 17],
      ['interview-audio-2', 'audio', ['音'], 18],
      ['cafe-noise', 'audio', ['音'], 50],
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
      ['book-cover-ref', 'image', ['参考'], 9],
      ['typesetting-sample', 'image', ['参考'], 9],
      ['web-capture-0921', 'image', ['参考'], 31],
      ['grid-system', 'image', ['参考'], 31],
      ['magazine-spread', 'image', ['参考'], 90],
      ['signage-photo', 'image', ['参考', '写真/街'], 120],
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
      ['spring-poster', 'image', ['配色'], 200],
      ['spring-flyer', 'image', ['配色'], 205],
      ['IMG_0412', 'image', ['写真'], 210],
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

/* どこにも入っていない取り込み。自動分類がタグを出す（プロジェクトは出さない）。 */
const LOOSE: [name: string, moved: number, like: string | null, main: string[]][] = [
  ['IMG_3310', 19, '秋の企画', ['写真', '配色']],
  ['IMG_3311', 19, '秋の企画', ['写真']],
  ['IMG_3312', 19, '秋の企画', ['写真']],
  ['IMG_3313', 19, '秋の企画', ['写真']],
  ['IMG_3314', 19, '秋の企画', ['写真', '配色']],
  ['IMG_3315', 19, '秋の企画', ['写真']],
  ['IMG_3316', 19, '旅行 2026', ['写真/旅行']],
  ['IMG_3317', 19, '旅行 2026', ['写真/旅行']],
  ['IMG_3318', 19, '秋の企画', ['配色']],
  ['IMG_3319', 19, null, ['写真']],
  ['スクリーンショット 2026-10-03 10.12', 19, 'UI 改善', ['UI']],
  ['スクリーンショット 2026-10-03 10.14', 19, 'UI 改善', ['UI']],
  ['download (3)', 4, null, ['参考', '資料']],
  ['download (4)', 4, null, ['参考']],
  ['image (12)', 2, '秋の企画', ['配色']],
  ['pasted-image', 1, 'UI 改善', ['UI']],
  ['scan-0930', 22, null, ['参考', '資料']],
  ['untitled', 8, null, ['参考']],
  ['photo_1021', 1, '旅行 2026', ['写真/旅行']],
  ['capture', 6, null, ['UI']],
  ['voice-1019', 3, 'インタビュー', ['音']],
  ['clip-0412', 11, 'インタビュー', ['動画']],
]
const TAG_POOL: Record<string, string[]> = {
  秋の企画: ['写真', '配色', '秋', '参考'],
  '旅行 2026': ['写真/旅行', '旅', '参考'],
  'UI 改善': ['UI', '参考', '配色'],
  インタビュー: ['音', '動画', '取材'],
  資料: ['参考', '資料', '写真'],
}

const charSum = (s: string) => {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i)
  return n
}
const AR = [1.5, 1.33, 1, 0.75, 0.67, 1.5, 1.33, 1.6]
const ratioOf = (kind: ItemKind, name: string) =>
  kind === 'note' ? 0.8 : kind === 'video' ? 1.78 : kind === 'audio' ? 1.6 : (AR[charSum(name) % AR.length] ?? 1)

const blocks = (raw: RawBlock[]): NoteBlock[] => raw.map(([type, text]) => ({ type, text }))

/** 見本のライブラリを作る。呼ぶたびに同じ中身の新しいものを返す。 */
export function sampleLibrary(): Library {
  let seed = 20261022
  const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646)
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))

  const items: Item[] = []
  const add = (it: Omit<Item, 'id' | 'ratio' | 'rating' | 'memo'> & { rating?: number }) => {
    const full: Item = {
      ...it,
      id: `i${items.length + 1}`,
      ratio: ratioOf(it.kind, it.name),
      rating: it.rating ?? 0,
      memo: '',
    }
    items.push(full)
    return full
  }
  const hueOf = new Map(PROJECTS.map((p) => [p.name, p.hue]))

  for (const [pn, s] of Object.entries(SPEC)) {
    const h = hueOf.get(pn) ?? 0
    for (const [name, kind, tags, moved] of s.a) {
      const rating = ri(0, 5)
      const hue = h + ri(-20, 20)
      add({ kind, name, tags: [...tags], folder: pn, rating, moved, hue, sat: ri(14, 30) })
    }
    for (const [name, moved, tags, raw] of s.n) {
      add({
        kind: 'note',
        name,
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

  const linkable = items.filter((i) => i.kind !== 'note')
  const pick = () => linkable[Math.floor(rnd() * linkable.length)]?.name ?? ''
  for (let d = 0; d < 30; d++) {
    if (d % 5 === 3) continue
    const t = new Date(TODAY.getTime() - d * 864e5)
    const name = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    const raw: RawBlock[] = [['p', DAILY[(d * 3) % DAILY.length] ?? '']]
    if (d % 2 === 0) {
      const a = pick()
      const b = pick()
      raw.push(['p', `候補：[[${a}]]、[[${b}]]。`])
    }
    add({ kind: 'note', name, folder: '日記', tags: [], moved: d, hue: 262, sat: 14, blocks: blocks(raw), aliases: [] })
  }

  let order = 0
  const suggest = (like: string | null, main: string[]): Suggestion => {
    const conf = rnd() < 0.72 ? 'よく似ている' : 'やや似ている'
    const tags = main.map((tag, i) => ({ tag, conf: i === 0 ? conf : 'やや似ている', on: true }))
    for (const tag of (like && TAG_POOL[like]) || ['参考', '写真', '配色'])
      if (tags.length < 4 && !tags.some((x) => x.tag === tag))
        tags.push({ tag, conf: tags.length < 3 ? 'やや似ている' : '少し似ている', on: false })
    return { tags, key: `# ${main[0]}`, order: order++ }
  }
  for (const [name, moved, like, main] of LOOSE) {
    const kind: ItemKind = name.startsWith('voice') ? 'audio' : name.startsWith('clip') ? 'video' : 'image'
    const base = like ? (hueOf.get(like) ?? 40) : 40
    const hue = base + ri(-14, 14)
    const it = add({ kind, name, tags: [], folder: null, moved, hue, sat: ri(10, 24) })
    it.suggestion = suggest(like, main)
  }
  add({ kind: 'image', name: 'ref-a', tags: ['参考'], folder: null, moved: 26, hue: 40, sat: 18 })
  add({ kind: 'image', name: 'ref-b', tags: ['参考'], folder: null, moved: 26, hue: 44, sat: 18 })

  const byName = new Map(items.map((i) => [i.name, i]))
  const projects: Project[] = PROJECTS.map(({ pinNames, cover, ...p }) => ({
    ...p,
    cover: structuredClone(cover),
    pins: pinNames.flatMap((n) => byName.get(n)?.id ?? []),
  }))
  return buildLibrary(items, projects, TODAY)
}

/** ホームにピン留めしているプロジェクトとタグ。 */
export const PINNED_PROJECTS = ['秋の企画', '日記']
export const PINNED_TAGS = ['写真', 'UI', '参考']
