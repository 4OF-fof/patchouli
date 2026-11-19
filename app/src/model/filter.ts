import { type Item, hasTag, newerFirst } from './library'
import type { Sort } from './prefs'
import { fold } from './search'

/** 同じ条件の中はどれかに当たれば残し、条件どうしはすべてに当たるものを残す。 */
export interface ItemFilter {
  name: string
  exts: string[]
  tags: string[]
  /** '' は所属なし */
  projects: string[]
  /** この日数より前に更新したものを外す。0 は外さない */
  within: number
}

export const NO_FILTER: ItemFilter = { name: '', exts: [], tags: [], projects: [], within: 0 }

export const filtering = (f: ItemFilter) =>
  !!f.name.trim() || f.exts.length > 0 || f.tags.length > 0 || f.projects.length > 0 || f.within > 0

export const matcher = (f: ItemFilter) => {
  const q = fold(f.name.trim())
  return (it: Item) =>
    (!q || fold(it.name).includes(q)) &&
    (!f.exts.length || f.exts.includes(it.ext)) &&
    (!f.tags.length || f.tags.some((t) => hasTag(it, t))) &&
    (!f.projects.length || f.projects.includes(it.project ?? '')) &&
    (!f.within || it.moved < f.within)
}

export const sorter = (sort: Sort, kindOf: (it: Item) => string) =>
  sort === 'name'
    ? (a: Item, b: Item) => a.name.localeCompare(b.name, 'ja')
    : sort === 'kind'
      ? (a: Item, b: Item) =>
          Number(b.note) - Number(a.note) || kindOf(a).localeCompare(kindOf(b), 'ja') || newerFirst(a, b)
      : newerFirst

/** 多い順に並べた、値ごとの件数。 */
export const counted = (xs: string[]) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
}
