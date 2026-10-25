/* 画面が読む素材・ノート・プロジェクトの形と、そこから出す集計。保存や読み込みはまだない。 */

export type ItemKind = 'image' | 'video' | 'audio' | 'note'

/** ノート本文の 1 段。text の中の [[名前]] がリンクになる。 */
export interface NoteBlock {
  type: 'p' | 'h2' | 'li'
  text: string
}

/** 自動分類が出したタグの候補。 */
export interface TagCandidate {
  tag: string
  /** 「よく似ている」「やや似ている」など。 */
  conf: string
  on: boolean
}

export interface Suggestion {
  tags: TagCandidate[]
  /** 同じ候補をまとめて承認するときの鍵（例「# 写真」）。 */
  key: string
  /** 取り込んだ順。 */
  order: number
}

export interface Item {
  id: string
  kind: ItemKind
  name: string
  /** 入っているプロジェクト。null はどこにも入っていない。 */
  folder: string | null
  tags: string[]
  /** 最後に動いてから何日たったか。 */
  moved: number
  /** 仮の絵の色相と彩度。 */
  hue: number
  sat: number
  /** 縦横比（幅 / 高さ）。 */
  ratio: number
  rating: number
  memo: string
  blocks?: NoteBlock[]
  aliases?: string[]
  suggestion?: Suggestion
}

export type CoverPart =
  | { type: 'desc'; text: string }
  /** due は「2026-11-15」の形の期日。 */
  | { type: 'todo'; items: { t: string; ref?: string; done: boolean; due?: string }[] }
  | { type: 'links'; items: { t: string; u: string }[] }

export interface Project {
  name: string
  hue: number
  /** 最後に扱った日（表示用の文字）。 */
  touched: string
  cover: CoverPart[]
  /** ピン留めした項目の id（留めた順）。 */
  pins: string[]
}

const LINK_RE = /\[\[([^\]]+)\]\]/g

/** 本文の中の [[名前]] を順に返す（重複なし）。 */
export function refsOfBlocks(blocks: NoteBlock[]): string[] {
  const out = new Set<string>()
  for (const b of blocks) for (const m of b.text.matchAll(LINK_RE)) if (m[1]) out.add(m[1])
  return [...out]
}

/** [[名前]] を外した本文の文字。 */
export function plainText(blocks: NoteBlock[]): string {
  return blocks
    .map((b) => b.text.replace(LINK_RE, '$1'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 本文を文字とリンクに分ける。 */
export function splitLinks(text: string): ({ text: string } | { ref: string })[] {
  const out: ({ text: string } | { ref: string })[] = []
  let last = 0
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ ref: m[1] ?? '' })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export const hasTag = (it: Item, t: string) => it.tags.some((x) => x === t || x.startsWith(t + '/'))

export interface Library {
  today: Date
  items: Item[]
  projects: Project[]
  byId: Map<string, Item>
  byName: Map<string, Item>
  projectBy: Map<string, Project>
  /** このノートからリンクしている、あるもの。 */
  linksOf: (note: Item) => Item[]
  /** この項目へリンクしているノート。 */
  backOf: (it: Item) => Item[]
  linkCount: (it: Item) => number
  inProject: (name: string) => Item[]
  /** タグごとの項目（「写真/旅行」は「写真/旅行」だけに数える）。 */
  tagGroups: () => Map<string, Item[]>
  /** 自動分類の確認を待っているもの（取り込んだ順）。 */
  pending: () => Item[]
}

export function buildLibrary(items: Item[], projects: Project[], today: Date): Library {
  const byId = new Map(items.map((i) => [i.id, i]))
  const byName = new Map(items.map((i) => [i.name, i]))
  const projectBy = new Map(projects.map((p) => [p.name, p]))
  const links = new Map<string, Item[]>()
  const back = new Map<string, Item[]>()
  for (const n of items) {
    if (n.kind !== 'note' || !n.blocks) continue
    const to = refsOfBlocks(n.blocks)
      .map((r) => byName.get(r))
      .filter((x): x is Item => !!x && x !== n)
    links.set(n.id, to)
    for (const t of to) back.set(t.id, [...(back.get(t.id) ?? []), n])
  }
  const linksOf = (n: Item) => links.get(n.id) ?? []
  const backOf = (it: Item) => back.get(it.id) ?? []
  return {
    today,
    items,
    projects,
    byId,
    byName,
    projectBy,
    linksOf,
    backOf,
    linkCount: (it) => (it.kind === 'note' ? linksOf(it).length : 0) + backOf(it).length,
    inProject: (name) => items.filter((i) => i.folder === name),
    tagGroups: () => {
      const m = new Map<string, Item[]>()
      for (const i of items) for (const t of i.tags) m.set(t, [...(m.get(t) ?? []), i])
      return m
    },
    pending: () =>
      items
        .filter((i) => i.suggestion && !i.folder && !i.tags.length)
        .toSorted((a, b) => (a.suggestion?.order ?? 0) - (b.suggestion?.order ?? 0)),
  }
}

/** 空のプロジェクトを足したライブラリと、その名前。名前は「新しいプロジェクト」「新しいプロジェクト 2」…と重ならないように付ける。 */
export function withEmptyProject(lib: Library, now = new Date()): { lib: Library; name: string } {
  const base = '新しいプロジェクト'
  let name = base
  for (let n = 2; lib.projectBy.has(name); n++) name = `${base} ${n}`
  const hm = `${now.getHours()}`.padStart(2, '0') + ':' + `${now.getMinutes()}`.padStart(2, '0')
  const p: Project = { name, hue: 210, touched: `今日 ${hm}`, cover: [], pins: [] }
  return { lib: buildLibrary(lib.items, [...lib.projects, p], lib.today), name }
}

/** 空のノートを足したライブラリと、その id。名前がなければ「新しいノート」にし、重なるときは番号を付ける。 */
export function withEmptyNote(lib: Library, name = '新しいノート'): { lib: Library; id: string } {
  let n = name
  for (let k = 2; lib.byName.has(n); k++) n = `${name} ${k}`
  const id = `i${lib.items.length + 1}`
  const note: Item = {
    id,
    kind: 'note',
    name: n,
    folder: null,
    tags: [],
    moved: 0,
    hue: 210,
    sat: 14,
    ratio: 0.8,
    rating: 0,
    memo: '',
    blocks: [],
    aliases: [],
  }
  return { lib: buildLibrary([...lib.items, note], lib.projects, lib.today), id }
}

/* ---------- 表示の文字 ---------- */

const DAY = 864e5

/** d 日前の「10/22」。 */
export const monthDay = (lib: Library, d: number) => {
  const t = new Date(lib.today.getTime() - d * DAY)
  return `${t.getMonth() + 1}/${t.getDate()}`
}

/** 「今日」「昨日」「3 日前」「10/5」。 */
export const relDay = (lib: Library, d: number) =>
  d <= 0 ? '今日' : d === 1 ? '昨日' : d < 7 ? `${d} 日前` : monthDay(lib, d)

/** 期日の「11/15」と「あと 24 日」。late は過ぎている。 */
export function dueLabel(lib: Library, date: string) {
  const t = new Date(date + 'T12:00')
  const d = Math.round((t.getTime() - lib.today.getTime()) / DAY)
  return {
    date: `${t.getMonth() + 1}/${t.getDate()}`,
    left: d > 0 ? `あと ${d} 日` : d === 0 ? '今日' : `${-d} 日過ぎた`,
    late: d < 0,
  }
}

/** カードの名前の下の一言（なぜここにあるか）。 */
export function whyOf(lib: Library, it: Item) {
  if (it.kind === 'note' && it.moved === 0) return '編集 · 今日'
  const n = lib.linkCount(it)
  if (n >= 2) return `つながり ${n} · ${relDay(lib, it.moved)}`
  if (it.rating === 5) return `★5 · ${relDay(lib, it.moved)}`
  return `${it.kind === 'note' ? '編集' : '更新'} · ${relDay(lib, it.moved)}`
}

/** カードの大きさ。L 大 / M 中 / S 小 / X 絵だけ。 */
export type CardSize = 'L' | 'M' | 'S' | 'X'

/** Thumb に渡す値。ノートは大きさに合わせて本文を切る。 */
export function thumbOf(it: Item, size: CardSize = 'M') {
  if (it.kind !== 'note') return { kind: it.kind, hue: it.hue, sat: it.sat }
  if (size === 'X') return { kind: it.kind, excerpt: it.name }
  const ex = plainText(it.blocks ?? [])
  const lim = size === 'L' ? 140 : size === 'S' ? 0 : 46
  return { kind: it.kind, title: it.name, excerpt: lim ? ex.slice(0, lim) + (ex.length > lim ? '…' : '') : '' }
}

/** プロジェクトの表紙に並べる項目（見本に選んだもの → 素材の新しい順）。 */
export function coverOf(lib: Library, p: Project, n: number) {
  return lib
    .inProject(p.name)
    .toSorted((a, b) => Number(a.kind === 'note') - Number(b.kind === 'note') || a.moved - b.moved)
    .slice(0, n)
}

/** まだ済んでいないやることのうち、いちばん近い期日。 */
export function nextDue(p: Project): string | undefined {
  return p.cover
    .flatMap((c) => (c.type === 'todo' ? c.items : []))
    .flatMap((x) => (!x.done && x.due ? [x.due] : []))
    .toSorted()[0]
}

/** ホームでの重み。つながりと評価が多いほど前に出る。 */
export const scoreOf = (lib: Library, it: Item) => lib.linkCount(it) * 2 + it.rating + (it.kind === 'note' ? 1 : 0)
