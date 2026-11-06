import {
  COVER_TYPES,
  type CoverPart,
  type Group,
  type Item,
  NOTE_RATIO,
  type Project,
  TAG_COVER_TYPES,
  type TagCoverPart,
  buildLibrary,
  daysBefore,
  touchedLabel,
} from '../model/library'
import type { CoverInfo, FormatInfo, LinkInfo, NotesInfo, ScreenInfo } from '../plugins/types'
import type { Changed, LibraryState, Opened, Orphan } from './types'

export interface StoredItem {
  id: string
  note: boolean
  name: string
  ext: string
  project: string | null
  group: string | null
  tags: string[]
  memo: string
  aliases?: string[]
  body?: string
  mtime: number
  width?: number
  height?: number
  waveThumb?: boolean
}

export interface StoredProject {
  name: string
  cover: CoverPart[]
  mtime: number
}

export interface StoredGroup {
  id: string
  name: string
  project: string | null
  parent: string | null
  type?: string
  mtime: number
}

export interface StoredLibrary<I extends StoredItem = StoredItem> {
  root: string
  items: I[]
  projects: StoredProject[]
  groups: StoredGroup[]
  state: Partial<LibraryState>
  tagCovers: Record<string, TagCoverPart[]>
  orphans: Orphan[]
  formats: FormatInfo[]
  links?: LinkInfo[]
  screens?: ScreenInfo[]
  covers?: CoverInfo[]
  notes?: NotesInfo
  problems: string[]
}

export interface StoredChanged<I extends StoredItem = StoredItem> {
  items: I[]
  removed: string[]
  projects?: StoredProject[]
  groups?: StoredGroup[]
  state?: Partial<LibraryState>
  tagCovers?: Record<string, TagCoverPart[]>
  orphans?: Orphan[]
  problems: string[]
}

const hash = (s: string) => {
  let n = 0
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0
  return n
}

const hueOfName = (name: string) => hash(name) % 360

function ratioOf(s: StoredItem, formats: ReadonlyMap<string, FormatInfo>) {
  if (s.note) return NOTE_RATIO
  if (s.width && s.height) return s.width / s.height
  return formats.get(s.ext)?.ratio ?? 1.6
}

export interface ItemUrls {
  src?: string
  thumb?: string
}

export function toItem(
  s: StoredItem,
  today: Date,
  formats: ReadonlyMap<string, FormatInfo>,
  urls: ItemUrls = {},
): Item {
  const h = hash(s.name)
  const base = s.project ? hueOfName(s.project) : 40
  return {
    id: s.id,
    note: s.note,
    name: s.name,
    project: s.project,
    group: s.group,
    tags: s.tags,
    moved: daysBefore(today, new Date(s.mtime)),
    mtime: s.mtime,
    hue: s.note ? base : (base + (h % 41) - 20 + 360) % 360,
    ratio: ratioOf(s, formats),
    fit: formats.get(s.ext)?.fit,
    ext: s.ext,
    memo: s.memo,
    ...(s.body !== undefined && { body: s.body }),
    ...(s.aliases && { aliases: s.aliases }),
    ...(urls.src && { src: urls.src }),
    ...(urls.thumb && { thumb: urls.thumb }),
    ...(urls.thumb && s.waveThumb && { waveThumb: true }),
  }
}

/** プラグインのカードは、どのプラグインのどのカードかが書いてあるものだけを読む。 */
const known = (types: ReadonlySet<string>, c: CoverPart | TagCoverPart) =>
  types.has(c.type) && (c.type !== 'plugin' || (typeof c.plugin === 'string' && typeof c.card === 'string'))

export const toProject = (s: StoredProject, today: Date): Project => ({
  name: s.name,
  hue: hueOfName(s.name),
  touched: touchedLabel(today, new Date(s.mtime)),
  cover: s.cover.filter((c) => known(COVER_TYPES, c)),
})

export const toGroup = (s: StoredGroup, today: Date): Group => ({
  id: s.id,
  name: s.name,
  project: s.project,
  parent: s.parent,
  ...(s.type && { type: s.type }),
  touched: touchedLabel(today, new Date(s.mtime)),
  mtime: s.mtime,
})

// 並びにだけ書かれた知らない id は、中身のない種類として届くので外す
const toTagCovers = (s: Record<string, TagCoverPart[]>) =>
  new Map(Object.entries(s).map(([t, c]) => [t, c.filter((x) => known(TAG_COVER_TYPES, x))]))

export function toOpened<I extends StoredItem>(s: StoredLibrary<I>, today: Date, urlsOf: (it: I) => ItemUrls): Opened {
  const formats = new Map(s.formats.map((f) => [f.ext, f]))
  const items = s.items.map((i) => toItem(i, today, formats, urlsOf(i)))
  const projects = s.projects.toSorted((a, b) => b.mtime - a.mtime).map((p) => toProject(p, today))
  const covers = toTagCovers(s.tagCovers)
  const ids = new Set(items.map((i) => i.id))
  return {
    lib: buildLibrary(
      items,
      projects,
      today,
      covers,
      (s.state.pins ?? []).filter((id) => ids.has(id)),
      formats,
      s.groups.map((g) => toGroup(g, today)),
    ),
    pinnedProjects: s.state.pinnedProjects ?? [],
    pinnedTags: s.state.pinnedTags ?? [],
    orphans: s.orphans,
    location: s.root,
    screens: s.screens ?? [],
    problems: s.problems,
  }
}

export const toChanged = <I extends StoredItem>(
  s: StoredChanged<I>,
  today: Date,
  formats: ReadonlyMap<string, FormatInfo>,
  urlsOf: (it: I) => ItemUrls,
): Changed => ({
  items: s.items.map((i) => toItem(i, today, formats, urlsOf(i))),
  removed: s.removed,
  ...(s.projects && {
    projects: s.projects.toSorted((a, b) => b.mtime - a.mtime).map((p) => toProject(p, today)),
  }),
  ...(s.groups && { groups: s.groups.map((g) => toGroup(g, today)) }),
  ...(s.state && { state: s.state }),
  ...(s.tagCovers && { tagCovers: toTagCovers(s.tagCovers) }),
  ...(s.orphans && { orphans: s.orphans }),
  problems: s.problems,
})
