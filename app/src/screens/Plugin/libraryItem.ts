import type { LibraryItem } from '../../../plugins/sdk'
import type { Item } from '../../model/library'

/** 画面のプラグインに渡す形。 */
export const libraryItemOf = (it: Item, pins: ReadonlySet<string>): LibraryItem => ({
  id: it.id,
  note: it.note,
  name: it.name,
  ext: it.ext,
  project: it.project,
  tags: it.tags,
  ...(it.body !== undefined && { body: it.body }),
  memo: it.memo,
  ...(it.mtime !== undefined && { mtime: it.mtime }),
  pinned: pins.has(it.id),
  ratio: it.ratio,
  ...(it.thumb && { thumb: it.thumb }),
  ...(it.src && { url: it.src }),
})
