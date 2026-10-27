/* 画面が読む素材・ノート・プロジェクトの形と、そこから出す集計。読み書きは backend/ が受け持つ。 */
import { BUILTIN_FORMATS } from '../plugins/builtin'
import type { Fit, FormatInfo } from '../plugins/types'

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
  /** 取り込んだ順。 */
  order: number
}

export interface Item {
  id: string
  /** ノート。ノートはアプリが特別に扱い、ほかの形式はプラグインが受け持つ。 */
  note: boolean
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
  /** 拡張子（小文字）。形式を決める。 */
  ext: string
  rating: number
  memo: string
  blocks?: NoteBlock[]
  aliases?: string[]
  suggestion?: Suggestion
  /** 中身を表示する URL。 */
  src?: string
  /** サムネイルの URL。作れる形式だけにあり、まだできていなければない。 */
  thumb?: string
  /** サムネイルを決まった形の枠に入れるときの収め方（形式から決める）。 */
  fit?: Fit
}

export type CoverPart =
  | { type: 'desc'; text: string }
  /** due は「2026-11-15」の形の期日。 */
  | { type: 'todo'; items: { t: string; ref?: string; done: boolean; due?: string }[] }
  | { type: 'links'; items: { t: string; u: string }[] }

/** タグの表紙の部品。説明のほかは、中身をタグの付いた項目から数える。 */
export type TagCoverPart = { type: 'desc'; text: string } | { type: 'kids' } | { type: 'exts' } | { type: 'together' }

export interface Project {
  name: string
  hue: number
  /** 最後に扱った日（表示用の文字）。 */
  touched: string
  cover: CoverPart[]
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

/** ノートの拡張子。 */
export const NOTE_EXT = 'md'

/** v が入っていれば外し、なければ後ろに足した新しいリスト。 */
export const toggled = <T>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export const hasTag = (it: Item, t: string) => it.tags.some((x) => x === t || x.startsWith(t + '/'))

export interface Library {
  today: Date
  items: Item[]
  projects: Project[]
  byId: Map<string, Item>
  byName: Map<string, Item>
  projectBy: Map<string, Project>
  /** タグごとの表紙。ないタグは表紙が空。 */
  tagCovers: Map<string, TagCoverPart[]>
  /** ピン留めした項目の id（留めた順）。プロジェクトやタグの詳細、ホームで同じものを使う。 */
  pins: string[]
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
  /** 扱える形式（拡張子 → 形式）。 */
  formats: ReadonlyMap<string, FormatInfo>
  /** 形式の呼び名（「画像」「動画」など）。 */
  formatLabel: (it: Item) => string
}

export function buildLibrary(
  items: Item[],
  projects: Project[],
  today: Date,
  tagCovers = new Map<string, TagCoverPart[]>(),
  pins: string[] = [],
  formats: ReadonlyMap<string, FormatInfo> = BUILTIN_FORMATS,
): Library {
  const byId = new Map(items.map((i) => [i.id, i]))
  const byName = new Map(items.map((i) => [i.name, i]))
  const projectBy = new Map(projects.map((p) => [p.name, p]))
  const links = new Map<string, Item[]>()
  const back = new Map<string, Item[]>()
  for (const n of items) {
    if (!n.note || !n.blocks) continue
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
    tagCovers,
    pins,
    linksOf,
    backOf,
    linkCount: (it) => (it.note ? linksOf(it).length : 0) + backOf(it).length,
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
    formats,
    formatLabel: (it) => formats.get(it.ext)?.label ?? it.ext.toUpperCase(),
  }
}

/** 新しいプロジェクトの名前。「新しいプロジェクト」「新しいプロジェクト 2」…と重ならないように付ける。 */
export function newProjectName(lib: Library) {
  const base = '新しいプロジェクト'
  let name = base
  for (let n = 2; lib.projectBy.has(name); n++) name = `${base} ${n}`
  return name
}

export const emptyProject = (name: string, now = new Date()): Project => ({
  name,
  hue: 210,
  touched: touchedLabel(now, now),
  cover: [],
})

/** プロジェクトを足したライブラリ。 */
export const withProject = (lib: Library, p: Project) =>
  buildLibrary(lib.items, [...lib.projects, p], lib.today, lib.tagCovers, lib.pins, lib.formats)

/** 空のプロジェクトを足したライブラリと、その名前。 */
export function withEmptyProject(lib: Library, now = new Date()): { lib: Library; name: string } {
  const name = newProjectName(lib)
  return { lib: withProject(lib, emptyProject(name, now)), name }
}

/** 項目 id のピン留めを切り替えたライブラリ。 */
export const withToggledPin = (lib: Library, id: string) =>
  buildLibrary(lib.items, lib.projects, lib.today, lib.tagCovers, toggled(lib.pins, id), lib.formats)

/** できたサムネイル。ratio はサムネイルの縦横比（元と同じ）。 */
export interface Thumbnail {
  url: string
  ratio: number
}

/** できたサムネイル（id → サムネイル）を付けたライブラリ。縦横比もサムネイルに合わせる（大きさを読めない形式のため）。 */
export const withThumbs = (lib: Library, thumbs: Map<string, Thumbnail>) =>
  buildLibrary(
    lib.items.map((i) => {
      const t = thumbs.get(i.id)
      return t ? { ...i, thumb: t.url, ratio: t.ratio } : i
    }),
    lib.projects,
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
  )

/** タグ from を to に変えたときの、タグ t の新しい名前。下の階層も付け替える。 */
export const retag = (from: string, to: string) => (t: string) =>
  t === from ? to : t.startsWith(from + '/') ? to + t.slice(from.length) : t

/** タグの名前を変えたライブラリ。下の階層（「写真/旅行」など）も付け替え、同じ名前のタグがすでにあればまとめる。 */
export function withRenamedTag(lib: Library, from: string, to: string): Library {
  const re = retag(from, to)
  const items = lib.items.map((i) => ({
    ...i,
    tags: [...new Set(i.tags.map(re))],
    suggestion: i.suggestion && { ...i.suggestion, tags: i.suggestion.tags.map((c) => ({ ...c, tag: re(c.tag) })) },
  }))
  const covers = new Map([...lib.tagCovers].map(([t, c]) => [re(t), c]))
  return buildLibrary(items, lib.projects, lib.today, covers, lib.pins, lib.formats)
}

/** 新しいノートの名前。名前がなければ「新しいノート」にし、重なるときは番号を付ける。 */
export function newNoteName(lib: Library, name = '新しいノート') {
  let n = name
  for (let k = 2; lib.byName.has(n); k++) n = `${name} ${k}`
  return n
}

export const emptyNote = (id: string, name: string, folder: string | null = null): Item => ({
  id,
  note: true,
  name,
  folder,
  ext: NOTE_EXT,
  tags: [],
  moved: 0,
  hue: 210,
  sat: 14,
  ratio: 0.8,
  rating: 0,
  memo: '',
  blocks: [],
  aliases: [],
})

/** 項目を足したライブラリ。 */
export const withItem = (lib: Library, it: Item) => withAdded(lib, [it])

/** 項目とプロジェクトを足したライブラリ。 */
export const withAdded = (lib: Library, items: Item[], projects: Project[] = []) =>
  buildLibrary(
    [...lib.items, ...items],
    [...projects, ...lib.projects],
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
  )

/** items を足すか同じ id のものと差し替え、removed の id を除いたライブラリ。ピン留めからも、なくなったものを除く。 */
export function withChanged(
  lib: Library,
  items: Item[],
  removed: string[],
  projects = lib.projects,
  tagCovers = lib.tagCovers,
  pins = lib.pins,
) {
  const gone = new Set(removed)
  const next = new Map(items.map((i) => [i.id, i]))
  const kept = lib.items.filter((i) => !gone.has(i.id) || next.has(i.id)).map((i) => next.get(i.id) ?? i)
  const have = new Set(kept.map((i) => i.id))
  const all = [...kept, ...items.filter((i) => !have.has(i.id))]
  const ids = new Set(all.map((i) => i.id))
  return buildLibrary(
    all,
    projects,
    lib.today,
    tagCovers,
    pins.filter((id) => ids.has(id)),
    lib.formats,
  )
}

/** タグの名前を変えたとき、タグが変わった項目。 */
export const retaggedItems = (before: Library, after: Library) =>
  after.items.filter((i) => {
    const old = before.byId.get(i.id)
    return !!old && (old.tags.length !== i.tags.length || old.tags.some((t, k) => t !== i.tags[k]))
  })

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

const startOfDay = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()

/** today から見て、t が何日前の日付か。 */
export const daysBefore = (today: Date, t: Date) => Math.max(0, Math.round((startOfDay(today) - startOfDay(t)) / DAY))

/** プロジェクトの「最後に扱った日」。「今日 09:40」「昨日」「3 日前」「10/5」「2025/5/10」。 */
export function touchedLabel(today: Date, t: Date) {
  const d = daysBefore(today, t)
  if (d === 0) return `今日 ${`${t.getHours()}`.padStart(2, '0')}:${`${t.getMinutes()}`.padStart(2, '0')}`
  if (d === 1) return '昨日'
  if (d < 7) return `${d} 日前`
  const md = `${t.getMonth() + 1}/${t.getDate()}`
  return t.getFullYear() === today.getFullYear() ? md : `${t.getFullYear()}/${md}`
}

/** 期日の「11/15」と「あと 24 日」。late は過ぎている。 */
export function dueLabel(lib: Library, date: string) {
  const t = new Date(date + 'T12:00')
  const d = Math.round((t.getTime() - lib.today.getTime()) / DAY)
  return {
    date: `${t.getMonth() + 1}/${t.getDate()}`,
    left: d > 0 ? `あと ${d} 日` : d === 0 ? '今日まで' : `${-d} 日超過`,
    late: d < 0,
  }
}

/** カードの名前の下の一言（なぜここにあるか）。 */
export function whyOf(lib: Library, it: Item) {
  if (it.note && it.moved === 0) return '編集 · 今日'
  const n = lib.linkCount(it)
  if (n >= 2) return `リンク ${n} · ${relDay(lib, it.moved)}`
  if (it.rating === 5) return `★5 · ${relDay(lib, it.moved)}`
  return `${it.note ? '編集' : '更新'} · ${relDay(lib, it.moved)}`
}

/** カードの大きさ。L 大 / M 中 / S 小 / X 絵だけ。 */
export type CardSize = 'L' | 'M' | 'S' | 'X'

/** Thumb に渡す値。ノートは大きさに合わせて本文を切る。 */
export function thumbOf(it: Item, size: CardSize = 'M') {
  if (!it.note) return { hue: it.hue, sat: it.sat, src: it.thumb, ext: it.ext, fit: it.fit }
  if (size === 'X') return { note: true, excerpt: it.name }
  const ex = plainText(it.blocks ?? [])
  const lim = size === 'L' ? 140 : size === 'S' ? 0 : 46
  return { note: true, title: it.name, excerpt: lim ? ex.slice(0, lim) + (ex.length > lim ? '…' : '') : '' }
}

/** プロジェクトの表紙に並べる項目（見本に選んだもの → 素材の新しい順）。 */
export function coverOf(lib: Library, p: Project, n: number) {
  return lib
    .inProject(p.name)
    .toSorted((a, b) => Number(a.note) - Number(b.note) || a.moved - b.moved)
    .slice(0, n)
}

/** 表紙の枠に渡す値。ノートの本文は切らずに渡し、枠に入るところまで出す。 */
export const coverTile = (it: Item) =>
  it.note ? { note: true, title: it.name, excerpt: plainText(it.blocks ?? []).slice(0, 400) } : thumbOf(it)

/** まだ済んでいないやることのうち、いちばん近い期日。 */
export function nextDue(p: Project): string | undefined {
  return p.cover
    .flatMap((c) => (c.type === 'todo' ? c.items : []))
    .flatMap((x) => (!x.done && x.due ? [x.due] : []))
    .toSorted()[0]
}

/** ホームでの重み。つながりと評価が多いほど前に出る。 */
export const scoreOf = (lib: Library, it: Item) => lib.linkCount(it) * 2 + it.rating + (it.note ? 1 : 0)
