import type { ArchiveEntry, ArchiveThumb } from '../backend/types'
import type { FormatInfo } from '../plugins/types'
import { type Group, ICON_RATIO, type Item, NOTE_EXT } from './library'

/** アーカイブの中のファイル。ライブラリの項目ではないので、編集はできない。 */
export interface EntryItem extends Item {
  archive: string
  path: string
  size: number
  encrypted: boolean
  executable: boolean
}

export const isEntry = (it: Item): it is EntryItem => 'archive' in it

/** 読み取り専用のノートとして表示するサイズの上限。 */
const NOTE_MAX = 8 << 20

export const isNoteEntry = (it: Item) => isEntry(it) && it.ext === NOTE_EXT && it.size <= NOTE_MAX

export interface ArchiveFolder extends Group {
  files: EntryItem[]
  folders: ArchiveFolder[]
  /** サブフォルダも含めたファイルの件数 */
  count: number
  /** サブフォルダも含めたファイルの合計サイズ */
  size: number
}

export interface ArchiveTree {
  folders: Map<string, ArchiveFolder>
  files: Map<string, EntryItem>
}

export const entryId = (archive: string, path: string) => `${archive}!${path}`

/** id が item か、その中のファイルか。 */
export const isInside = (id: string, item: string) => id === item || id.startsWith(`${item}!`)

const splitName = (file: string) => {
  const dot = file.lastIndexOf('.')
  return dot > 0 ? [file.slice(0, dot), file.slice(dot + 1).toLowerCase()] : [file, '']
}

const entryItem = (archive: string, e: ArchiveEntry, formats: ReadonlyMap<string, FormatInfo>): EntryItem => {
  const [name = '', ext = ''] = splitName(e.path.slice(e.path.lastIndexOf('/') + 1))
  const f = formats.get(ext)
  return {
    id: entryId(archive, e.path),
    note: false,
    name,
    project: null,
    group: null,
    tags: [],
    moved: 0,
    hue: 40,
    ratio: e.encrypted ? ICON_RATIO : (f?.ratio ?? ICON_RATIO),
    ext,
    memo: '',
    fit: f?.fit,
    archive,
    path: e.path,
    size: e.size,
    encrypted: e.encrypted,
    executable: !!e.executable,
    thumbMark: e.encrypted ? 'lock' : ext === NOTE_EXT ? 'note' : undefined,
  }
}

const folderOf = (path: string, name: string, parent: string | null): ArchiveFolder => ({
  id: path,
  name,
  project: null,
  parent,
  touched: '',
  mtime: 0,
  files: [],
  folders: [],
  count: 0,
  size: 0,
})

export function archiveTree(
  archive: string,
  entries: ArchiveEntry[],
  formats: ReadonlyMap<string, FormatInfo>,
): ArchiveTree {
  const root = folderOf('', '', null)
  const folders = new Map([['', root]])
  const files = new Map<string, EntryItem>()
  const place = (parts: string[]) => {
    let at = root
    for (const name of parts) {
      const path = at.id ? `${at.id}/${name}` : name
      let next = folders.get(path)
      if (!next) {
        next = folderOf(path, name, at.id)
        folders.set(path, next)
        at.folders.push(next)
      }
      at = next
    }
    return at
  }
  for (const e of entries) {
    const parts = e.path.split('/').filter((p) => p && p !== '.' && p !== '..')
    if (!parts.pop()) continue
    const it = entryItem(archive, e, formats)
    files.set(it.id, it)
    place(parts).files.push(it)
  }
  const total = (f: ArchiveFolder) => {
    f.count = f.files.length
    f.size = f.files.reduce((n, it) => n + it.size, 0)
    for (const sub of f.folders) {
      total(sub)
      f.count += sub.count
      f.size += sub.size
    }
  }
  total(root)
  return { folders, files }
}

export const filesUnder = (f: ArchiveFolder): EntryItem[] => [...f.files, ...f.folders.flatMap(filesUnder)]

export const sameThumb = (it: EntryItem, t: ArchiveThumb) => ('failed' in t ? !!it.thumbFailed : it.thumb === t.url)

export const withThumb = (it: EntryItem, t: ArchiveThumb): EntryItem =>
  'failed' in t
    ? { ...it, thumbFailed: true }
    : {
        ...it,
        thumb: t.url,
        thumbFailed: false,
        waveThumb: t.wave,
        ratio: t.width && t.height ? t.width / t.height : it.ratio,
      }
