import { type Accessor, type Signal, createSignal } from 'solid-js'
import { ICON_NAMES, type IconName } from '../components/base/Icon/Icon'
import { sorter } from '../model/filter'
import { type Item, type Library, samePlace } from '../model/library'
import { prefs } from '../model/prefs'
import { hostOf } from '../plugins/links'
import type { ScreenInfo } from '../plugins/types'

export type View =
  | { s: 'edition' }
  | { s: 'all' }
  | { s: 'project'; name: string; editing?: boolean }
  | { s: 'group'; id: string }
  | { s: 'plist' }
  | { s: 'tlist' }
  | { s: 'tag'; tag: string }
  | { s: 'note'; id: string }
  | { s: 'asset'; list: string[]; index: number; at?: number }
  | { s: 'tidy'; id?: string }
  | { s: 'web'; url: string }
  | { s: 'screen'; plugin: string; id: string; targets?: string[] }

export const LABEL: Record<View['s'], string> = {
  edition: 'ホーム',
  all: 'すべて',
  project: 'プロジェクト',
  group: 'グループ',
  plist: 'プロジェクト一覧',
  tlist: 'タグ一覧',
  tag: 'タグ',
  note: 'ノート',
  asset: '素材',
  tidy: '分類の確認',
  web: 'ウェブページ',
  screen: '画面',
}

const TAB_ICON: Record<View['s'], IconName> = {
  edition: 'home',
  all: 'grid',
  project: 'project',
  group: 'group',
  plist: 'project',
  tlist: 'hash',
  tag: 'hash',
  note: 'note',
  asset: 'file',
  tidy: 'tag',
  web: 'link',
  screen: 'plugin',
}

export interface Tab {
  id: number
  stack: Accessor<View[]>
  setStack: (s: View[]) => void
  /** 裏に開いたタブの、開いたもとのタブ。 */
  from?: Tab
}

const str = (x: unknown) => (typeof x === 'string' ? x : undefined)
export const recordOf = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? Object.fromEntries(Object.entries(x)) : {}

export const screenIcon = (s: ScreenInfo): IconName => ICON_NAMES.find((n) => n === s.icon) ?? 'plugin'

/** 開き直した素材の前後に並べるもの。来た画面の項目を、既定の順に並べる。 */
function assetList(lib: Library, from: View | undefined, it: Item) {
  const items =
    from?.s === 'all'
      ? lib.items
      : from?.s === 'project'
        ? lib.inProject(from.name)
        : from?.s === 'group'
          ? lib.inGroup(from.id)
          : from?.s === 'tag'
            ? (lib.tagGroups().get(from.tag) ?? [])
            : lib.items.filter((x) => samePlace(x, it))
  const ids = items
    .filter((x) => !x.note)
    .toSorted(sorter(prefs().sort, (x) => lib.formats.get(x.ext)?.label ?? x.ext))
    .map((x) => x.id)
  return ids.includes(it.id) ? ids : [it.id]
}

/** 保存したタブの 1 段を読む。from は、そのタブで 1 つ前の段。 */
export function viewOf(lib: Library, screens: ScreenInfo[], v: unknown, from?: View): View | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const x: Record<string, unknown> = Object.fromEntries(Object.entries(v))
  switch (x.s) {
    case 'edition':
    case 'all':
    case 'plist':
    case 'tlist':
    case 'tidy':
      return { s: x.s }
    case 'project': {
      const name = str(x.name)
      return name && lib.projectBy.has(name) ? { s: 'project', name } : undefined
    }
    case 'group': {
      const id = str(x.id)
      return id && lib.groupBy.has(id) ? { s: 'group', id } : undefined
    }
    case 'tag': {
      const tag = str(x.tag)
      return tag ? { s: 'tag', tag } : undefined
    }
    case 'note': {
      const id = str(x.id)
      return id && lib.byId.get(id)?.note ? { s: 'note', id } : undefined
    }
    case 'asset': {
      const it = lib.byId.get(str(x.id) ?? '')
      if (it) {
        if (it.note) return undefined
        const list = assetList(lib, from, it)
        return { s: 'asset', list, index: list.indexOf(it.id) }
      }
      const list = (Array.isArray(x.list) ? x.list : []).filter(
        (id): id is string => typeof id === 'string' && lib.byId.get(id)?.note === false,
      )
      const index = typeof x.index === 'number' ? x.index : 0
      return list.length ? { s: 'asset', list, index: Math.min(Math.max(0, index), list.length - 1) } : undefined
    }
    case 'web': {
      const url = str(x.url)
      return url && /^https?:\/\//i.test(url) ? { s: 'web', url } : undefined
    }
    case 'screen': {
      const [plugin, id] = [str(x.plugin), str(x.id)]
      const targets = Array.isArray(x.targets) ? x.targets.filter((t): t is string => typeof t === 'string') : []
      return screens.some((s) => s.plugin === plugin && s.id === id) && plugin && id
        ? { s: 'screen', plugin, id, ...(targets.length && { targets }) }
        : undefined
    }
  }
  return undefined
}

/** 画面ごとの名前・アイコンと、素材の画面で動いた位置。 */
export function createViews(d: { lib: Accessor<Library>; screens: Accessor<ScreenInfo[]> }) {
  const { lib, screens } = d
  const screenOfView = (v: View & { s: 'screen' }) => screens().find((s) => s.plugin === v.plugin && s.id === v.id)
  // 素材の画面で動いた位置。並びの View に書くと画面が作り直されるので、別に持つ
  const assetIndexes = new WeakMap<View, Signal<number>>()
  const assetIndexOf = (v: View & { s: 'asset' }) => {
    const s = assetIndexes.get(v) ?? createSignal(v.index)
    assetIndexes.set(v, s)
    return s
  }
  const assetIndex = (v: View & { s: 'asset' }) => assetIndexOf(v)[0]()
  const labelOf = (v: View) =>
    v.s === 'project'
      ? v.name
      : v.s === 'group'
        ? (lib().groupBy.get(v.id)?.name ?? LABEL.group)
        : v.s === 'tag'
          ? `# ${v.tag}`
          : v.s === 'note'
            ? (lib().byId.get(v.id)?.name ?? LABEL.note)
            : v.s === 'asset'
              ? (lib().byId.get(v.list[assetIndex(v)] ?? '')?.name ?? LABEL.asset)
              : v.s === 'web'
                ? (hostOf(v.url) ?? LABEL.web)
                : v.s === 'screen'
                  ? (screenOfView(v)?.label ?? LABEL.screen)
                  : LABEL[v.s]
  const iconOf = (v: View): IconName => {
    const s = v.s === 'screen' && screenOfView(v)
    return s ? screenIcon(s) : TAB_ICON[v.s]
  }
  // 素材の前後の並びは数千件になることがあるので書かず、開き直すときに来た画面から作り直す
  const savedView = (v: View): unknown =>
    v.s === 'asset'
      ? { s: 'asset', id: v.list[assetIndex(v)] }
      : v.s === 'project'
        ? { s: 'project', name: v.name }
        : v.s === 'tidy'
          ? { s: 'tidy' }
          : v
  return { screenOfView, assetIndexOf, assetIndex, labelOf, iconOf, savedView }
}
