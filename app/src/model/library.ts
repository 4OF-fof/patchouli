import { BUILTIN_FORMATS } from '../plugins/builtin'
import type { Fit, FormatInfo } from '../plugins/types'

export interface TagCandidate {
  tag: string
  conf: string
  on: boolean
}

export interface Suggestion {
  tags: TagCandidate[]
  order: number
}

export interface Item {
  id: string
  note: boolean
  name: string
  folder: string | null
  tags: string[]
  moved: number
  hue: number
  sat: number
  ratio: number
  ext: string
  rating: number
  memo: string
  body?: string
  aliases?: string[]
  suggestion?: Suggestion
  src?: string
  thumb?: string
  fit?: Fit
}

export type CoverPart =
  | { type: 'desc'; text: string }
  | { type: 'todo'; items: { t: string; ref?: string; done: boolean; due?: string }[] }
  | { type: 'links'; items: { t: string; u: string }[] }

export type TagCoverPart = { type: 'desc'; text: string } | { type: 'kids' } | { type: 'exts' } | { type: 'together' }

export interface Project {
  name: string
  hue: number
  touched: string
  cover: CoverPart[]
}

export const LINK_SCHEME = 'patchouli:'

const LINK_RE = /!?\[((?:\\.|[^\]\\])*)\]\(patchouli:([^)\s]+)\)/g

export function refsOf(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(LINK_RE)) if (m[2]) out.add(m[2])
  return [...out]
}

const inlineText = (s: string) =>
  s
    .replace(/!\[(?:\\.|[^\]\\])*\]\([^)]*\)/g, '')
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/[*`~]+/g, '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')

const FENCE_RE = /^ {0,3}(```|~~~)/

export function plainText(body: string): string {
  return body
    .split('\n')
    .filter((l) => !FENCE_RE.test(l) && !/^\s*\|?\s*:?-{3,}/.test(l))
    .map((l) =>
      inlineText(
        l
          .replace(/^ {0,3}#{1,6}\s+/, '')
          .replace(/^\s*(?:>\s?)+/, '')
          .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ''),
      ).replace(/\|/g, ' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface Heading {
  level: number
  text: string
}

export function headingsOf(body: string): Heading[] {
  const out: Heading[] = []
  let fence = false
  for (const l of body.split('\n')) {
    if (FENCE_RE.test(l)) fence = !fence
    if (fence) continue
    const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (m?.[1] && m[2]) out.push({ level: m[1].length, text: inlineText(m[2]) })
  }
  return out
}

export const NOTE_EXT = 'md'

export const toggled = <T>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export const hasTag = (it: Item, t: string) => it.tags.some((x) => x === t || x.startsWith(t + '/'))

export interface Library {
  today: Date
  items: Item[]
  projects: Project[]
  byId: Map<string, Item>
  byName: Map<string, Item>
  projectBy: Map<string, Project>
  tagCovers: Map<string, TagCoverPart[]>
  pins: string[]
  linksOf: (note: Item) => Item[]
  backOf: (it: Item) => Item[]
  linkCount: (it: Item) => number
  inProject: (name: string) => Item[]
  tagGroups: () => Map<string, Item[]>
  pending: () => Item[]
  formats: ReadonlyMap<string, FormatInfo>
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
    if (!n.note || !n.body) continue
    const to = refsOf(n.body)
      .map((r) => byId.get(r))
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

export const withProject = (lib: Library, p: Project) =>
  buildLibrary(lib.items, [...lib.projects, p], lib.today, lib.tagCovers, lib.pins, lib.formats)

export function withEmptyProject(lib: Library, now = new Date()): { lib: Library; name: string } {
  const name = newProjectName(lib)
  return { lib: withProject(lib, emptyProject(name, now)), name }
}

export const withToggledPin = (lib: Library, id: string) =>
  buildLibrary(lib.items, lib.projects, lib.today, lib.tagCovers, toggled(lib.pins, id), lib.formats)

export interface Thumbnail {
  url: string
  ratio: number
}

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

export const retag = (from: string, to: string) => (t: string) =>
  t === from ? to : t.startsWith(from + '/') ? to + t.slice(from.length) : t

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
  body: '',
  aliases: [],
})

export const withItem = (lib: Library, it: Item) => withAdded(lib, [it])

export const withAdded = (lib: Library, items: Item[], projects: Project[] = []) =>
  buildLibrary(
    [...lib.items, ...items],
    [...projects, ...lib.projects],
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
  )

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

export const retaggedItems = (before: Library, after: Library) =>
  after.items.filter((i) => {
    const old = before.byId.get(i.id)
    return !!old && (old.tags.length !== i.tags.length || old.tags.some((t, k) => t !== i.tags[k]))
  })

const DAY = 864e5

export const monthDay = (lib: Library, d: number) => {
  const t = new Date(lib.today.getTime() - d * DAY)
  return `${t.getMonth() + 1}/${t.getDate()}`
}

export const relDay = (lib: Library, d: number) =>
  d <= 0 ? '今日' : d === 1 ? '昨日' : d < 7 ? `${d} 日前` : monthDay(lib, d)

const startOfDay = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()

export const daysBefore = (today: Date, t: Date) => Math.max(0, Math.round((startOfDay(today) - startOfDay(t)) / DAY))

export function touchedLabel(today: Date, t: Date) {
  const d = daysBefore(today, t)
  if (d === 0) return `今日 ${`${t.getHours()}`.padStart(2, '0')}:${`${t.getMinutes()}`.padStart(2, '0')}`
  if (d === 1) return '昨日'
  if (d < 7) return `${d} 日前`
  const md = `${t.getMonth() + 1}/${t.getDate()}`
  return t.getFullYear() === today.getFullYear() ? md : `${t.getFullYear()}/${md}`
}

export function dueLabel(lib: Library, date: string) {
  const t = new Date(date + 'T12:00')
  const d = Math.round((t.getTime() - lib.today.getTime()) / DAY)
  return {
    date: `${t.getMonth() + 1}/${t.getDate()}`,
    left: d > 0 ? `あと ${d} 日` : d === 0 ? '今日まで' : `${-d} 日超過`,
    late: d < 0,
  }
}

export function whyOf(lib: Library, it: Item) {
  if (it.note && it.moved === 0) return '編集 · 今日'
  const n = lib.linkCount(it)
  if (n >= 2) return `リンク ${n} · ${relDay(lib, it.moved)}`
  if (it.rating === 5) return `★5 · ${relDay(lib, it.moved)}`
  return `${it.note ? '編集' : '更新'} · ${relDay(lib, it.moved)}`
}

export type CardSize = 'L' | 'M' | 'S' | 'X'

export function thumbOf(it: Item, size: CardSize = 'M') {
  if (!it.note) return { hue: it.hue, sat: it.sat, src: it.thumb, id: it.id, fit: it.fit }
  if (size === 'X') return { note: true, excerpt: it.name }
  const ex = plainText(it.body ?? '')
  const lim = size === 'L' ? 140 : size === 'S' ? 0 : 46
  return { note: true, title: it.name, excerpt: lim ? ex.slice(0, lim) + (ex.length > lim ? '…' : '') : '' }
}

export function coverOf(lib: Library, p: Project, n: number) {
  return lib
    .inProject(p.name)
    .toSorted((a, b) => Number(a.note) - Number(b.note) || a.moved - b.moved)
    .slice(0, n)
}

export const coverTile = (it: Item) =>
  it.note ? { note: true, title: it.name, excerpt: plainText(it.body ?? '').slice(0, 400) } : thumbOf(it)

export function nextDue(p: Project): string | undefined {
  return p.cover
    .flatMap((c) => (c.type === 'todo' ? c.items : []))
    .flatMap((x) => (!x.done && x.due ? [x.due] : []))
    .toSorted()[0]
}

export const scoreOf = (lib: Library, it: Item) => lib.linkCount(it) * 2 + it.rating + (it.note ? 1 : 0)
