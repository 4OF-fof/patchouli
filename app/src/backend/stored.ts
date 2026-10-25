/* 保存先から届く項目とプロジェクトの形と、それを画面の形にする処理。Tauri と同期サーバーで同じ形を使う。 */
import {
  type CoverPart,
  type Item,
  type ItemKind,
  type NoteBlock,
  type Project,
  buildLibrary,
  daysBefore,
  touchedLabel,
} from '../model/library'
import type { LibraryState, Opened } from './types'

export interface StoredItem {
  id: string
  kind: ItemKind
  name: string
  ext: string
  folder: string | null
  tags: string[]
  rating: number
  memo: string
  aliases?: string[]
  blocks?: NoteBlock[]
  /** 更新日時（UNIX ミリ秒）。 */
  mtime: number
  width?: number
  height?: number
}

export interface StoredProject {
  name: string
  cover: CoverPart[]
  /** フォルダと中身のうち、いちばん新しい更新日時（UNIX ミリ秒）。 */
  mtime: number
}

export interface StoredLibrary<I extends StoredItem = StoredItem> {
  /** ライブラリの場所。 */
  root: string
  items: I[]
  projects: StoredProject[]
  state: Partial<LibraryState>
  problems: string[]
}

const hash = (s: string) => {
  let n = 0
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0
  return n
}

/** 絵のないときの仮の色。プロジェクトは名前から決め、入っている項目はその近くの色にする。 */
const hueOfName = (name: string) => hash(name) % 360

function ratioOf(s: StoredItem) {
  if (s.width && s.height) return s.width / s.height
  return s.kind === 'note' ? 0.8 : s.kind === 'video' ? 16 / 9 : 1.6
}

/** 項目の中身とサムネイルを表示する URL。 */
export interface ItemUrls {
  src?: string
  thumb?: string
}

export function toItem(s: StoredItem, today: Date, urls: ItemUrls = {}): Item {
  const h = hash(s.name)
  const base = s.folder ? hueOfName(s.folder) : 40
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    folder: s.folder,
    tags: s.tags,
    moved: daysBefore(today, new Date(s.mtime)),
    hue: s.kind === 'note' ? base : (base + (h % 41) - 20 + 360) % 360,
    sat: s.kind === 'note' ? 16 : 14 + (h % 17),
    ratio: ratioOf(s),
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

/** 届いた中身から画面のライブラリを作る。プロジェクトは最近扱った順に並べる。 */
export function toOpened<I extends StoredItem>(s: StoredLibrary<I>, today: Date, urlsOf: (it: I) => ItemUrls): Opened {
  const items = s.items.map((i) => toItem(i, today, urlsOf(i)))
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
    ),
    pinnedProjects: s.state.pinnedProjects ?? [],
    pinnedTags: s.state.pinnedTags ?? [],
    location: s.root,
    problems: s.problems,
  }
}
