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
  project: string | null
  /** 直接入っているグループの ID */
  group: string | null
  tags: string[]
  moved: number
  /** 更新した時刻（ミリ秒）。同じ日のものを並べるのに使う */
  mtime?: number
  hue: number
  sat: number
  ratio: number
  ext: string
  memo: string
  body?: string
  aliases?: string[]
  suggestion?: Suggestion
  src?: string
  thumb?: string
  /** thumb を波形から描いたもの */
  waveThumb?: boolean
  /** サムネイルを作れなかった */
  thumbFailed?: boolean
  fit?: Fit
}

/** 概要のカード。中身を持たないカード（タグの kids など）は、種類をそのまま id にする。 */
export type CoverPart = { id: string } & (
  | { type: 'desc'; text: string }
  | { type: 'todo'; items: { t: string; ref?: string; done: boolean; due?: string }[] }
  | { type: 'links'; items: { t: string; u: string }[] }
)

export type TagCoverPart = { id: string } & (
  | { type: 'desc'; text: string }
  | { type: 'kids' }
  | { type: 'exts' }
  | { type: 'together' }
)

export const COVER_TYPES: ReadonlySet<string> = new Set<CoverPart['type']>(['desc', 'todo', 'links'])
export const TAG_COVER_TYPES: ReadonlySet<string> = new Set<TagCoverPart['type']>(['desc', 'kids', 'exts', 'together'])

export interface Project {
  name: string
  hue: number
  touched: string
  cover: CoverPart[]
}

export interface Group {
  id: string
  name: string
  project: string | null
  parent: string | null
  /** プラグインが足す特殊なグループの種類。ただのグループは持たない */
  type?: string
  touched: string
  mtime: number
}

/** 素材を置く場所。group があれば、project はそのグループのものになる */
export interface Place {
  project: string | null
  group: string | null
}

export const ROOT: Place = { project: null, group: null }

export const placeOf = (x: { project: string | null; group: string | null }): Place => ({
  project: x.project,
  group: x.group,
})

export const samePlace = (a: Place, b: Place) => a.project === b.project && a.group === b.group

export const LINK_SCHEME = 'patchouli:'

/** 埋め込みの大きさ。ふだんの大きさに対する %。リンク先の後ろに ?w=50% のように書き、100 のときは書かない */
export const EMBED_SCALES = [25, 50, 75, 100, 125, 150, 200]

/** リンク先の ID と、?w= に書いた埋め込みの大きさ。 */
export function targetOf(href: string): { id: string; scale: number } | undefined {
  if (!href.startsWith(LINK_SCHEME)) return undefined
  const [id = '', query = ''] = href.slice(LINK_SCHEME.length).split('?', 2)
  const w = Number(/(?:^|&)w=(\d+)%(?:&|$)/.exec(query)?.[1])
  return id ? { id, scale: EMBED_SCALES.includes(w) ? w : 100 } : undefined
}

export const hrefOf = (id: string, scale = 100) => `${LINK_SCHEME}${id}${scale === 100 ? '' : `?w=${scale}%`}`

const LINK_RE = /!?\[((?:\\.|[^\]\\])*)\]\(patchouli:([^)\s?]+)[^)\s]*\)/g

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
export const NOTE_LABEL = 'ノート'
export const NOTE_RATIO = 0.8

export const toggled = <T>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export const hasTag = (it: Item, t: string) => it.tags.some((x) => x === t || x.startsWith(t + '/'))

/** どれかの項目に付いているタグと、その上の階層。hasTag が真になるタグの集まり。 */
export function tagsUsed(lib: Library) {
  const used = new Set<string>()
  for (const t of lib.tagGroups().keys()) {
    const parts = t.split('/')
    for (let k = 1; k <= parts.length; k++) used.add(parts.slice(0, k).join('/'))
  }
  return used
}

export interface Library {
  today: Date
  items: Item[]
  projects: Project[]
  byId: Map<string, Item>
  byName: Map<string, Item>
  projectBy: Map<string, Project>
  groups: Group[]
  groupBy: Map<string, Group>
  tagCovers: Map<string, TagCoverPart[]>
  pins: string[]
  backOf: (it: Item) => Item[]
  /** プロジェクトの中の項目。グループの中のものも含む */
  inProject: (name: string) => Item[]
  /** グループの中の項目。下のグループの中のものも含む */
  inGroup: (id: string) => Item[]
  /** place に直接ある項目 */
  inPlace: (place: Place) => Item[]
  /** place に直接あるグループ */
  groupsIn: (place: Place) => Group[]
  /** 上から順に並べた、グループの並び。いちばん下が id のグループ */
  groupPath: (id: string) => Group[]
  /** 「プロジェクト / グループ / …」の形の名前。どこにも属さなければ null */
  placeName: (place: Place) => string | null
  tagGroups: () => Map<string, Item[]>
  pending: () => Item[]
  formats: ReadonlyMap<string, FormatInfo>
  formatLabel: (it: Item) => string
}

// サムネイルが届くたびにライブラリを作り直すので、変わっていないノートの本文は読み直さない。
// 項目は届き直すと別のものになるので、ID で覚える
const refsCache = new Map<string, { body: string; refs: string[] }>()

/** ノートの本文にあるリンク先の ID。refsOf と同じものを、本文が変わったときだけ数え直す */
export function noteRefs(n: Item) {
  const body = n.body ?? ''
  const c = refsCache.get(n.id)
  if (c?.body === body) return c.refs
  const refs = refsOf(body)
  refsCache.set(n.id, { body, refs })
  return refs
}

const once = <T>(make: () => T) => {
  let made: { v: T } | undefined
  return () => (made ??= { v: make() }).v
}

function bucket<K>(items: Item[], key: (i: Item) => K) {
  const m = new Map<K, Item[]>()
  for (const i of items) {
    const k = key(i)
    const l = m.get(k)
    if (l) l.push(i)
    else m.set(k, [i])
  }
  return m
}

export function buildLibrary(
  items: Item[],
  projects: Project[],
  today: Date,
  tagCovers = new Map<string, TagCoverPart[]>(),
  pins: string[] = [],
  formats: ReadonlyMap<string, FormatInfo> = BUILTIN_FORMATS,
  groups: Group[] = [],
): Library {
  const byId = new Map(items.map((i) => [i.id, i]))
  const byName = new Map(items.map((i) => [i.name, i]))
  const projectBy = new Map(projects.map((p) => [p.name, p]))
  const groupBy = new Map(groups.map((g) => [g.id, g]))
  const groupPath = (id: string) => {
    const out: Group[] = []
    for (let g = groupBy.get(id); g && !out.includes(g); g = g.parent ? groupBy.get(g.parent) : undefined)
      out.unshift(g)
    return out
  }
  const below = (id: string) => {
    const ids = new Set([id])
    for (let n = 0; n !== ids.size;) {
      n = ids.size
      for (const g of groups) if (g.parent && ids.has(g.parent)) ids.add(g.id)
    }
    return ids
  }
  // サムネイルが届くたびに作り直すので、重いものは使うときに 1 度だけ作る
  const linked = once(() => {
    const back = new Map<string, Item[]>()
    for (const n of items) {
      if (!n.note || !n.body) continue
      for (const r of noteRefs(n)) {
        const t = byId.get(r)
        if (!t || t === n) continue
        const b = back.get(t.id)
        if (b) b.push(n)
        else back.set(t.id, [n])
      }
    }
    return back
  })
  const backOf = (it: Item) => linked().get(it.id) ?? []
  const byProject = once(() => bucket(items, (i) => i.project))
  const byTag = once(() => {
    const m = new Map<string, Item[]>()
    for (const i of items)
      for (const t of i.tags) {
        const l = m.get(t)
        if (l) l.push(i)
        else m.set(t, [i])
      }
    return m
  })
  const inGroups = new Map<string, Item[]>()
  return {
    today,
    items,
    projects,
    byId,
    byName,
    projectBy,
    groups,
    groupBy,
    tagCovers,
    pins,
    backOf,
    inProject: (name) => byProject().get(name) ?? [],
    inGroup: (id) => {
      let got = inGroups.get(id)
      if (!got) {
        const ids = below(id)
        got = items.filter((i) => i.group !== null && ids.has(i.group))
        inGroups.set(id, got)
      }
      return got
    },
    inPlace: (place) =>
      items.filter((i) => i.group === place.group && (place.group !== null || i.project === place.project)),
    groupsIn: (place) =>
      groups.filter((g) => g.parent === place.group && (place.group !== null || g.project === place.project)),
    groupPath,
    placeName: (place) => {
      const names = [
        ...(place.project ? [place.project] : []),
        ...(place.group ? groupPath(place.group) : []).map((g) => g.name),
      ]
      return names.length ? names.join(' / ') : null
    },
    tagGroups: byTag,
    pending: () =>
      items
        .filter((i) => i.suggestion && !i.tags.length)
        .toSorted((a, b) => (a.suggestion?.order ?? 0) - (b.suggestion?.order ?? 0)),
    formats,
    formatLabel: (it) => (it.note ? NOTE_LABEL : (formats.get(it.ext)?.label ?? it.ext.toUpperCase())),
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
  buildLibrary(lib.items, [...lib.projects, p], lib.today, lib.tagCovers, lib.pins, lib.formats, lib.groups)

export function withEmptyProject(lib: Library, now = new Date()): { lib: Library; name: string } {
  const name = newProjectName(lib)
  return { lib: withProject(lib, emptyProject(name, now)), name }
}

export const withToggledPin = (lib: Library, id: string) =>
  buildLibrary(lib.items, lib.projects, lib.today, lib.tagCovers, toggled(lib.pins, id), lib.formats, lib.groups)

export type Thumbnail = { url: string; ratio: number; wave?: boolean } | { failed: true }

export const withThumbs = (lib: Library, thumbs: Map<string, Thumbnail>) =>
  buildLibrary(
    lib.items.map((i) => {
      const t = thumbs.get(i.id)
      if (!t) return i
      if ('failed' in t) return { ...i, thumbFailed: true }
      return { ...i, thumb: t.url, ratio: t.ratio, waveThumb: t.wave === true, thumbFailed: false }
    }),
    lib.projects,
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
    lib.groups,
  )

export const retag = (from: string, to: string) => (t: string) =>
  t === from ? to : t.startsWith(from + '/') ? to + t.slice(from.length) : t

/** 付いているタグと、その上の階層、概要のあるタグ。 */
function tagNames(lib: Library) {
  const names = new Set(lib.tagCovers.keys())
  for (const i of lib.items)
    for (const t of i.tags) {
      const parts = t.split('/')
      for (let k = 1; k <= parts.length; k++) names.add(parts.slice(0, k).join('/'))
    }
  return names
}

/** 名前を変えると、すでにあるタグと重なるか。covers は、重なる組の両方に概要があるとき。 */
export function tagClash(lib: Library, from: string, to: string) {
  const re = retag(from, to)
  const names = tagNames(lib)
  const hits = [...names].filter((t) => re(t) !== t && names.has(re(t)) && re(re(t)) === re(t))
  const has = (t: string) => !!lib.tagCovers.get(t)?.length
  return { clash: hits.length > 0, covers: hits.some((t) => has(t) && has(re(t))) }
}

/** 変えた先がすでにあれば、keepFrom のときは元の概要を、そうでなければ変えた先の概要を残す。 */
export function withRenamedTag(lib: Library, from: string, to: string, keepFrom = false): Library {
  const re = retag(from, to)
  const items = lib.items.map((i) =>
    i.tags.some((t) => re(t) !== t) || i.suggestion?.tags.some((c) => re(c.tag) !== c.tag)
      ? {
          ...i,
          tags: [...new Set(i.tags.map(re))],
          suggestion: i.suggestion && {
            ...i.suggestion,
            tags: i.suggestion.tags.map((c) => ({ ...c, tag: re(c.tag) })),
          },
        }
      : i,
  )
  const covers = new Map([...lib.tagCovers].filter(([t]) => re(t) === t))
  for (const [t, c] of lib.tagCovers) if (re(t) !== t && (keepFrom || !covers.has(re(t)))) covers.set(re(t), c)
  return buildLibrary(items, lib.projects, lib.today, covers, lib.pins, lib.formats, lib.groups)
}

export const newCardId = () => crypto.randomUUID().replaceAll('-', '')

export const withProjectCover = (lib: Library, name: string, cover: CoverPart[]) =>
  buildLibrary(
    lib.items,
    lib.projects.map((p) => (p.name === name ? { ...p, cover } : p)),
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
    lib.groups,
  )

/** cover を渡さなければ、概要を消す。 */
export function withTagCover(lib: Library, tag: string, cover?: TagCoverPart[]) {
  const covers = new Map(lib.tagCovers)
  if (cover) covers.set(tag, cover)
  else covers.delete(tag)
  return buildLibrary(lib.items, lib.projects, lib.today, covers, lib.pins, lib.formats, lib.groups)
}

export const withRenamedProject = (lib: Library, from: string, to: string) =>
  buildLibrary(
    lib.items.map((i) => (i.project === from ? { ...i, project: to } : i)),
    lib.projects.map((p) => (p.name === from ? { ...p, name: to } : p)),
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
    lib.groups.map((g) => (g.project === from ? { ...g, project: to } : g)),
  )

/** 中身は所属なしにする。 */
export const withoutProject = (lib: Library, name: string) =>
  buildLibrary(
    lib.items.map((i) => (i.project === name ? { ...i, project: null } : i)),
    lib.projects.filter((p) => p.name !== name),
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
    lib.groups.map((g) => (g.project === name ? { ...g, project: null } : g)),
  )

export function newNoteName(lib: Library, name = '新しいノート') {
  let n = name
  for (let k = 2; lib.byName.has(n); k++) n = `${name} ${k}`
  return n
}

export const emptyNote = (id: string, name: string, place: Place = ROOT): Item => ({
  id,
  note: true,
  name,
  ...placeOf(place),
  ext: NOTE_EXT,
  tags: [],
  moved: 0,
  mtime: Date.now(),
  hue: 210,
  sat: 14,
  ratio: NOTE_RATIO,
  memo: '',
  body: '',
  aliases: [],
})

export const withItem = (lib: Library, it: Item) => withAdded(lib, [it])

export const withAdded = (lib: Library, items: Item[], projects: Project[] = [], groups: Group[] = []) =>
  buildLibrary(
    [...lib.items, ...items],
    [...projects, ...lib.projects],
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
    [...lib.groups, ...groups],
  )

/** タグのない項目の候補を、届いたものに置き換える。 */
export function withSuggestions(lib: Library, s: Record<string, Suggestion>) {
  return buildLibrary(
    lib.items.map((i) => (s[i.id] === i.suggestion ? i : { ...i, suggestion: s[i.id] })),
    lib.projects,
    lib.today,
    lib.tagCovers,
    lib.pins,
    lib.formats,
    lib.groups,
  )
}

export function withChanged(
  lib: Library,
  items: Item[],
  removed: string[],
  projects = lib.projects,
  tagCovers = lib.tagCovers,
  pins = lib.pins,
  groups = lib.groups,
) {
  const gone = new Set(removed)
  const next = new Map(items.map((i) => [i.id, i]))
  const kept = lib.items
    .filter((i) => !gone.has(i.id) || next.has(i.id))
    .map((i) => {
      const n = next.get(i.id)
      return n ? { ...n, suggestion: n.suggestion ?? i.suggestion } : i
    })
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
    groups,
  )
}

const DAY = 864e5

export const monthDay = (lib: Library, d: number) => {
  const t = new Date(lib.today.getTime() - d * DAY)
  return `${t.getMonth() + 1}/${t.getDate()}`
}

export const relDay = (lib: Library, d: number) =>
  d <= 0 ? '今日' : d === 1 ? '昨日' : d < 7 ? `${d} 日前` : monthDay(lib, d)

const startOfDay = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()

/** 更新が新しい順。日数が同じなら時刻で比べる */
/** いちばん新しく動かしたものの moved。大きな配列を Math.min に広げると溢れるので、順に見る。 */
export const newestMoved = (items: readonly Item[], none = Infinity) => {
  let m = none
  for (const it of items) if (it.moved < m) m = it.moved
  return m
}
export const newerFirst = (a: Item, b: Item) => a.moved - b.moved || (b.mtime ?? 0) - (a.mtime ?? 0)

/** 表紙に向く順。サムネイルのある素材、これから作れる素材、ノート、サムネイルを作れない素材 */
const faceRank = (lib: Library, it: Item) =>
  it.note ? 2 : it.thumb ? 0 : lib.formats.has(it.ext) && !it.thumbFailed ? 1 : 3

/** グループの束に重ねて見せる項目。表紙に向くものを先に、新しい順で 3 件まで */
export const facesOf = (lib: Library, groupId: string) =>
  lib
    .inGroup(groupId)
    .toSorted((a, b) => faceRank(lib, a) - faceRank(lib, b) || newerFirst(a, b))
    .slice(0, 3)

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

/** 音声のジャケット。音声のサムネイルは、波形から描いたものでなければジャケット */
export const jacketOf = (it: Item) => (it.waveThumb ? undefined : it.thumb)

export type CardSize = 'L' | 'M' | 'S' | 'X'

export function thumbOf(it: Item, size: CardSize = 'M') {
  if (!it.note)
    return { hue: it.hue, sat: it.sat, src: it.thumb, id: it.id, fit: it.fit, ext: it.ext, failed: it.thumbFailed }
  if (size === 'X') return { note: true, id: it.id, excerpt: it.name }
  const ex = plainText(it.body ?? '')
  const lim = size === 'L' ? 140 : size === 'S' ? 0 : 46
  return {
    note: true,
    id: it.id,
    title: it.name,
    excerpt: lim ? ex.slice(0, lim) + (ex.length > lim ? '…' : '') : '',
  }
}

/** 表紙に使う順。ピン留めを先に、それぞれの中では更新が新しい順 */
export function coverOrder(lib: Library) {
  const pinned = new Set(lib.pins)
  return (a: Item, b: Item) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || newerFirst(a, b)
}

export function coverOf(lib: Library, p: Project, n: number) {
  const pinned = new Set(lib.pins)
  return lib
    .inProject(p.name)
    .toSorted(
      (a, b) =>
        Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || Number(a.note) - Number(b.note) || newerFirst(a, b),
    )
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
