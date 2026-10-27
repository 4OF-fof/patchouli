import {
  type CoverPart,
  type Item,
  type NoteBlock,
  type Project,
  buildLibrary,
  daysBefore,
  touchedLabel,
} from '../model/library'
import type { FormatInfo } from '../plugins/types'
import type { Changed, LibraryState, Opened } from './types'

export interface StoredItem {
  id: string
  note: boolean
  name: string
  ext: string
  folder: string | null
  tags: string[]
  rating: number
  memo: string
  aliases?: string[]
  blocks?: NoteBlock[]
  mtime: number
  width?: number
  height?: number
}

export interface StoredProject {
  name: string
  cover: CoverPart[]
  mtime: number
}

export interface StoredLibrary<I extends StoredItem = StoredItem> {
  root: string
  items: I[]
  projects: StoredProject[]
  state: Partial<LibraryState>
  formats: FormatInfo[]
  problems: string[]
}

export interface StoredChanged<I extends StoredItem = StoredItem> {
  items: I[]
  removed: string[]
  projects?: StoredProject[]
  state?: Partial<LibraryState>
  problems: string[]
}

const hash = (s: string) => {
  let n = 0
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0
  return n
}

const hueOfName = (name: string) => hash(name) % 360

function ratioOf(s: StoredItem, formats: ReadonlyMap<string, FormatInfo>) {
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
  const base = s.folder ? hueOfName(s.folder) : 40
  return {
    id: s.id,
    note: s.note,
    name: s.name,
    folder: s.folder,
    tags: s.tags,
    moved: daysBefore(today, new Date(s.mtime)),
    hue: s.note ? base : (base + (h % 41) - 20 + 360) % 360,
    sat: s.note ? 16 : 14 + (h % 17),
    ratio: ratioOf(s, formats),
    fit: formats.get(s.ext)?.fit,
    ext: s.ext,
    rating: s.rating,
    memo: s.memo,
    ...(s.blocks && { blocks: s.blocks }),
    ...(s.aliases && { aliases: s.aliases }),
    ...(urls.src && { src: urls.src }),
    ...(urls.thumb && { thumb: urls.thumb }),
  }
}

export const toProject = (s: StoredProject, today: Date): Project => ({
  name: s.name,
  hue: hueOfName(s.name),
  touched: touchedLabel(today, new Date(s.mtime)),
  cover: s.cover,
})

export function toOpened<I extends StoredItem>(s: StoredLibrary<I>, today: Date, urlsOf: (it: I) => ItemUrls): Opened {
  const formats = new Map(s.formats.map((f) => [f.ext, f]))
  const items = s.items.map((i) => toItem(i, today, formats, urlsOf(i)))
  const projects = s.projects.toSorted((a, b) => b.mtime - a.mtime).map((p) => toProject(p, today))
  const covers = new Map(Object.entries(s.state.tagCovers ?? {}))
  const ids = new Set(items.map((i) => i.id))
  return {
    lib: buildLibrary(
      items,
      projects,
      today,
      covers,
      (s.state.pins ?? []).filter((id) => ids.has(id)),
      formats,
    ),
    pinnedProjects: s.state.pinnedProjects ?? [],
    pinnedTags: s.state.pinnedTags ?? [],
    location: s.root,
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
  ...(s.state && { state: s.state }),
  problems: s.problems,
})
