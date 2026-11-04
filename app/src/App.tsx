import {
  type Accessor,
  For,
  Match,
  type Signal,
  Show,
  Switch,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import {
  type Backend,
  type Dropped,
  type Imported,
  type ItemPatch,
  type LibraryState,
  type Orphan,
  type PluginWork,
  type SavedTabs,
  sampleBackend,
} from './backend'
import { DropZone } from './components/overlay/DropZone/DropZone'
import { ReloadOverlay } from './components/overlay/ReloadOverlay/ReloadOverlay'
import { DeleteDialog } from './components/dialog/DeleteDialog/DeleteDialog'
import { MenuResultDialog } from './components/dialog/MenuResultDialog/MenuResultDialog'
import { OrphanDialog } from './components/dialog/OrphanDialog/OrphanDialog'
import { TagGoneDialog } from './components/dialog/TagGoneDialog/TagGoneDialog'
import { TagMergeDialog } from './components/dialog/TagMergeDialog/TagMergeDialog'
import { Toast, type ToastLevel } from './components/overlay/Toast/Toast'
import { Peek } from './components/overlay/Peek/Peek'
import { ItemMenu } from './components/overlay/ItemMenu/ItemMenu'
import {
  type CoverPart,
  hasTag,
  tagsUsed,
  type Item,
  type Suggestion,
  type Library,
  type Place as ItemPlace,
  ROOT,
  newNoteName,
  newProjectName,
  noteRefs,
  placeOf,
  retag,
  samePlace,
  tagClash,
  type TagCoverPart,
  toggled,
  withAdded,
  withChanged,
  withSuggestions,
  withItem,
  withProject,
  withProjectCover,
  withRenamedProject,
  withoutProject,
  withRenamedTag,
  withTagCover,
  type Thumbnail,
  withThumbs,
  withToggledPin,
} from './model/library'
import { FormatsProvider } from './plugins/formats'
import type { MenuGroup, ScreenInfo } from './plugins/types'
import type { NewNote, OpenOptions, OwnApi } from '../plugins/sdk'
import { ITEMS, REPLY, STATE, type FromWindow, type Reply, type WindowCall, type WindowState } from './window/protocol'
import { libraryItemOf } from './screens/Plugin/libraryItem'
import { type HoverHost, HoverHostProvider } from './components/media/HoverPreview/HoverPreview'
import type { Activity } from './components/nav/ActivityButton/ActivityButton'
import type { NavMenuItem } from './components/nav/NavMenu/NavMenu'
import { asNewTab, inNewTab } from './components/nav/TabPane/newTab'
import { TabPane } from './components/nav/TabPane/TabPane'
import { Seams } from './components/nav/SplitView/Seams'
import { PaneHint, PaneMenu, type PaneMove } from './components/nav/SplitView/PaneMenu'
import {
  type SplitNode,
  type SplitSide,
  type PaneDir,
  insertBeside,
  leaves,
  neighborOf,
  parseSplit,
  rectsOf,
  savedSplit,
  swapLeaves,
  withSizes,
  withoutLeaf,
} from './components/nav/SplitView/split'
import { TabList } from './components/nav/TabList/TabList'
import type { TabEntry, TabStripProps } from './components/nav/TabStrip/TabStrip'
import { sorter } from './model/filter'
import { applyPrefs, prefs, screenStart } from './model/prefs'
import { flush as flushWrites, persist as queueJob } from './model/persist'
import { ICON_NAMES, type IconName } from './components/base/Icon/Icon'
import { SelectionProvider, createSelection } from './components/media/Selection/Selection'
import {
  ItemMenuProvider,
  type MenuAt,
  ThumbMakingProvider,
  ThumbSeenProvider,
  watchSeen,
} from './components/media/Thumb/Thumb'
import { AllScreen } from './screens/All/AllScreen'
import { AppBar, type BarRequest, BarToolsProvider, type Place, type ScreenPlace } from './screens/AppBar'
import type { Blocker } from './components/media/Unsupported/Unsupported'
import { AssetScreen } from './screens/Asset/AssetScreen'
import { EditionScreen } from './screens/Edition/EditionScreen'
import { GroupScreen } from './screens/Group/GroupScreen'
import { NoteScreen } from './screens/Note/NoteScreen'
import type { NoteEditorApi, UrlPreview } from './components/editor/NoteEditor/NoteEditor'
import { embedOf as embedFor, urlEmbedOf as urlEmbedFor } from './screens/Note/embed'
import { WebScreen } from './screens/Web/WebScreen'
import { hostOf } from './plugins/links'
import { ProjectScreen } from './screens/Project/ProjectScreen'
import { ProjectListScreen } from './screens/ProjectList/ProjectListScreen'
import { ScreenFrame } from './screens/ScreenFrame'
import { PluginScreen } from './screens/Plugin/PluginScreen'
import { TagScreen } from './screens/Tag/TagScreen'
import { TagListScreen } from './screens/TagList/TagListScreen'
import { type TidyDecision, TidyScreen } from './screens/Tidy/TidyScreen'

type View =
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

const LABEL: Record<View['s'], string> = {
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

interface Tab {
  id: number
  stack: Accessor<View[]>
  setStack: (s: View[]) => void
  /** 裏に開いたタブの、開いたもとのタブ。 */
  from?: Tab
}

const PANE_DIRS: PaneDir[] = ['left', 'right', 'up', 'down']
/** 右クリックしても、ペインを動かすメニューを出さないところ。 */
const NOT_EMPTY =
  'input, textarea, select, button, a, [role="button"], [role="menuitem"], [contenteditable="true"], img, video, audio, canvas, iframe'

const str = (x: unknown) => (typeof x === 'string' ? x : undefined)

/** 設定と残した値を持てないときに、プラグインの画面に渡す窓口。 */
const NO_OWN: OwnApi = {
  settings: async () => ({}),
  setSetting: async () => {},
  getData: async () => undefined,
  setData: async () => {},
}

const screenIcon = (s: ScreenInfo): IconName => ICON_NAMES.find((n) => n === s.icon) ?? 'plugin'

/** ファイルから読んだ画面を、いまのライブラリとプラグインで開けるものだけにする。 */
const tabsAt = () => prefs().tabsAt

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
function viewOf(lib: Library, screens: ScreenInfo[], v: unknown, from?: View): View | undefined {
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

export interface AppProps {
  lib: Library
  backend?: Backend
  pinnedProjects?: string[]
  pinnedTags?: string[]
  orphans?: Orphan[]
  location?: string
  notice?: string
  screens?: ScreenInfo[]
}

const importedNotice = (r: Imported) => {
  const n = r.items.length
  const parts = [n ? `${n} 件を取り込みました` : '取り込めるファイルがありませんでした']
  if (r.groups.length) parts.push(`グループ ${r.groups.length} 件`)
  if (r.skipped) parts.push(`${r.skipped} 件はライブラリ内のファイルなどのためスキップ`)
  if (r.failed.length) parts.push(`${r.failed.length} 件のコピーに失敗`)
  return parts.join('、')
}

const REVEAL_LABEL = /Mac/.test(navigator.userAgent)
  ? 'Finder で表示'
  : /Windows/.test(navigator.userAgent)
    ? 'エクスプローラーで表示'
    : 'フォルダを開く'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** 通知に並べる名前の数。残りは件数だけ出す。 */
const NAMED = 5
const namesOf = (its: Item[]) =>
  its
    .slice(0, NAMED)
    .map((it) => `「${it.name}」`)
    .join('') + (its.length > NAMED ? `ほか ${its.length - NAMED} 件` : '')

const workCount = (w?: PluginWork) => (w ? w.thumbnails.length + w.waveforms.length : 0)

// 作り始めてから頼まれた素材を覚えておき、途中で増えたら total も増やす
function progress() {
  const [ids, setIds] = createSignal<ReadonlySet<string>>(new Set())
  const [seen, setSeen] = createSignal(0)
  let all = new Set<string>()
  const update = (now: string[]) => {
    if (!now.length) all = new Set()
    for (const id of now) all.add(id)
    if (now.length !== ids().size || now.some((id) => !ids().has(id))) setIds(new Set(now))
    setSeen(all.size)
  }
  return { ids, done: () => seen() - ids().size, total: seen, update }
}
type Progress = ReturnType<typeof progress>

/** 待っている書き込みを終えてから読み込み直す。 */
const reload = () => void flushWrites().finally(() => window.location.reload())

export function App(props: AppProps) {
  const backend = props.backend ?? sampleBackend()
  const [lib, setLib] = createSignal(props.lib)
  const [screens, setScreens] = createSignal(props.screens ?? [])
  const screenOfView = (v: View & { s: 'screen' }) => screens().find((s) => s.plugin === v.plugin && s.id === v.id)
  let tabSeq = 0
  const makeTab = (views: View[] = [{ s: 'edition' }], from?: Tab): Tab => {
    const [stack, setStack] = createSignal(views)
    return { id: tabSeq++, stack, setStack: (s) => setStack(s), from }
  }
  const startView = (): View => {
    const s = untrack(screens).find((x) => x.place && screenStart(x.plugin, x.id) === prefs().start)
    return s ? { s: 'screen', plugin: s.plugin, id: s.id } : { s: 'edition' }
  }
  const [tabs, setTabs] = createSignal<Tab[]>([makeTab([startView()])])
  const [currentTab, setCurrentTab] = createSignal(tabs()[0])
  // 分割して並べるタブのまとまり。currentTab は、いま操作しているペインのタブ
  const [splits, setSplits] = createSignal<SplitNode[]>([])
  const splitOf = (t: Tab) => splits().find((n) => leaves(n).includes(t.id))
  const shownSplit = () => splitOf(currentTab())
  // たたんだまとまりの表に、最後に操作したタブを出すため、操作した順を覚えておく
  const [seen, setSeen] = createSignal<ReadonlyMap<number, number>>(new Map())
  let seenSeq = 0
  createEffect(() => {
    const id = currentTab().id
    setSeen((m) => new Map(m).set(id, ++seenSeq))
  })
  const shownRects = createMemo(() => {
    const n = shownSplit()
    return n && rectsOf(n)
  })
  // 同じまとまりのタブは、ペインの並びの順に続けて並べる
  const setLayout = (list: Tab[], groups: SplitNode[]) => {
    const done = new Set<Tab>()
    const arranged = list.flatMap((t) => {
      if (done.has(t)) return []
      const g = groups.find((n) => leaves(n).includes(t.id))
      const ts = g ? leaves(g).flatMap((id) => list.find((x) => x.id === id) ?? []) : [t]
      for (const x of ts) done.add(x)
      return ts
    })
    batch(() => {
      setSplits(groups)
      setTabs(arranged)
    })
  }
  const stack = () => currentTab().stack()
  const setStack = (s: View[]) => currentTab().setStack(s)
  const eachStack = (f: (s: View[]) => View[]) => {
    for (const t of tabs()) t.setStack(f(t.stack()))
  }
  // 新しいタブは裏に開く。同じタブから続けて開いたものは、開いた順に並べる
  const openTab = (views: View[]) => {
    const list = tabs()
    let at = list.indexOf(currentTab()) + 1
    while (list[at]?.from === currentTab()) at++
    setLayout([...list.slice(0, at), makeTab(views, currentTab()), ...list.slice(at)], splits())
  }
  const addTab = () => {
    const t = makeTab()
    setTabs([...tabs(), t])
    setCurrentTab(t)
  }
  const closeTab = (id: number) => {
    const list = tabs()
    const i = list.findIndex((t) => t.id === id)
    const t = list[i]
    if (!t) return
    editors.delete(id)
    const ids = leaves(splitOf(t) ?? { tab: id })
    const j = ids.indexOf(id)
    const mate = ids[j + 1] ?? ids[j - 1]
    const rest = list.filter((x) => x !== t)
    if (!rest.length) rest.push(makeTab())
    batch(() => {
      setLayout(rest, withoutLeaf(splits(), id))
      if (currentTab() === t) setCurrentTab(rest.find((x) => x.id === mate) ?? rest[Math.min(i, rest.length - 1)])
    })
  }
  /** add を target の右か下に並べて、add を操作中にする。add がほかのまとまりにいたら、そこから抜く。 */
  const placeBeside = (target: Tab, add: Tab, side: SplitSide, list = tabs()) => {
    const groups = withoutLeaf(splits(), add.id)
    const g = groups.find((n) => leaves(n).includes(target.id))
    const next = g
      ? groups.map((n) => (n === g ? insertBeside(n, target.id, add.id, side) : n))
      : [...groups, insertBeside({ tab: target.id }, target.id, add.id, side)]
    batch(() => {
      const base = list.filter((x) => x !== add)
      setLayout(base.toSpliced(base.indexOf(target) + 1, 0, add), next)
      setCurrentTab(add)
    })
  }
  /** 見えていないタブを、操作中のペインの横に持ってくる。 */
  const splitTab = (id: number, side: SplitSide) => {
    const t = tabs().find((x) => x.id === id)
    if (t && !leaves(shownSplit() ?? { tab: currentTab().id }).includes(id)) placeBeside(currentTab(), t, side)
  }
  /** 分割から抜いて、ふつうのタブにする。抜いたタブはまとまりのすぐ後ろに置き、操作は残ったペインに移す。 */
  const detachTab = (id: number) => {
    const t = tabs().find((x) => x.id === id)
    const g = t && splitOf(t)
    if (!t || !g) return
    const ids = leaves(g)
    const j = ids.indexOf(id)
    const mate = ids[j + 1] ?? ids[j - 1]
    const rest = tabs().filter((x) => x !== t)
    const end = Math.max(...ids.map((x) => rest.findIndex((y) => y.id === x)))
    batch(() => {
      setLayout(rest.toSpliced(end + 1, 0, t), withoutLeaf(splits(), id))
      if (currentTab() === t) setCurrentTab(rest.find((x) => x.id === mate) ?? t)
    })
  }
  /** id のタブを、まとまりごと before の前に動かす。 */
  const moveTab = (id: number, before: number | undefined) => {
    const t = tabs().find((x) => x.id === id)
    if (!t) return
    const ids = leaves(splitOf(t) ?? { tab: id })
    const moving = tabs().filter((x) => ids.includes(x.id))
    const rest = tabs().filter((x) => !ids.includes(x.id))
    const at = before === undefined ? rest.length : rest.findIndex((x) => x.id === before)
    if (at < 0) return
    setLayout(rest.toSpliced(at, 0, ...moving), splits())
  }
  const [paneMenu, setPaneMenu] = createSignal<{ tab: Tab; x: number; y: number; moves: PaneMove[] }>()
  const [paneHint, setPaneHint] = createSignal<number>()
  /** 分割したペインの何もないところを右クリックしたら、動かせる向きを出す。入力欄や画像などの上では出さない。 */
  const openPaneMenu = (t: Tab, e: MouseEvent) => {
    const rects = shownRects()
    if (e.defaultPrevented || !rects?.has(t.id)) return
    if (e.target instanceof Element && e.target.closest(NOT_EMPTY)) return
    if (getSelection()?.toString()) return
    const moves = PANE_DIRS.flatMap((dir) => {
      const to = neighborOf(rects, t.id, dir)
      return to === undefined ? [] : [{ dir, to }]
    })
    if (!moves.length) return
    e.preventDefault()
    setCurrentTab(t)
    setPaneMenu({ tab: t, x: e.clientX, y: e.clientY, moves })
  }
  const movePane = (t: Tab, to: number) => {
    const g = splitOf(t)
    if (g)
      setLayout(
        tabs(),
        splits().map((n) => (n === g ? swapLeaves(n, t.id, to) : n)),
      )
  }
  /** open で新しいタブに開いたものを、操作中のペインの横に並べる。 */
  const openBeside = (side: SplitSide, open: () => void) => {
    const before = new Set(tabs())
    const from = currentTab()
    asNewTab(open)
    const t = tabs().find((x) => !before.has(x))
    if (t) placeBeside(from, t, side)
  }
  const tabStrip = (): TabStripProps => ({
    tabs: tabs().map(tabEntry),
    current: currentTab().id,
    onSelect: (id) => {
      const t = tabs().find((x) => x.id === id)
      if (t) setCurrentTab(t)
    },
    onClose: closeTab,
    onNew: addTab,
    onAction: (id, a) => (a === 'detach' ? detachTab(id) : splitTab(id, a)),
    onMove: moveTab,
  })
  createEffect(() => applyPrefs(prefs()))
  onMount(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const follow = () => applyPrefs(prefs())
    mq.addEventListener('change', follow)
    onCleanup(() => mq.removeEventListener('change', follow))
  })
  const tabEntry = (t: Tab): TabEntry => {
    const v = t.stack().at(-1) ?? { s: 'edition' }
    const g = splitOf(t)
    const face = g && leaves(g).reduce((a, b) => ((seen().get(b) ?? 0) > (seen().get(a) ?? 0) ? b : a))
    return {
      id: t.id,
      label: labelOf(v),
      icon: iconOf(v),
      shown: !!g && g === shownSplit(),
      group: g && splits().indexOf(g),
      face: face === t.id,
    }
  }
  const selection = createSelection((ids) => setDeleting(ids))
  const [pinnedProjects, setPinnedProjects] = createSignal(props.pinnedProjects ?? [])
  const [pinnedTags, setPinnedTags] = createSignal(props.pinnedTags ?? [])
  const [notice, setNotice] = createSignal<{ message: string; level: ToastLevel }>()
  const notify = (message: string, level: ToastLevel) => setNotice({ message, level })
  if (props.notice) notify(props.notice, 'error')
  const view = () => stack().at(-1) ?? { s: 'edition' }
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
  const crumbs = () => stack().map(labelOf)
  const go = (v: View) => (inNewTab() ? openTab([...stack(), v]) : setStack([...stack(), v]))
  const itemView = (id: string, list?: string[], at?: number): View | undefined => {
    const it = lib().byId.get(id)
    if (!it) return undefined
    if (it.note) return { s: 'note', id }
    const l = (list ?? [id]).filter((x) => lib().byId.get(x)?.note === false)
    return { s: 'asset', list: l, index: Math.max(0, l.indexOf(id)), at }
  }
  const openGroup = (id: string) => go({ s: 'group', id })
  const openItem = (id: string, list?: string[], at?: number) => {
    const v = itemView(id, list, at)
    if (v) go(v)
  }
  /** パンくずの段から切り替えられる、同じ種類の仲間。来た道によらず、その段の画面だけで決める */
  const siblingItems = (v: View): Item[] | undefined => {
    if (v.s === 'asset') {
      const list = v.list.flatMap((id) => lib().byId.get(id) ?? [])
      return list.length > 1 ? list : undefined
    }
    const n = v.s === 'note' ? lib().byId.get(v.id) : undefined
    return n && lib().items.filter((it) => samePlace(it, n))
  }
  const siblingsOf = (i: number): NavMenuItem[] | undefined => {
    const v = stack()[i]
    if (!v) return undefined
    const here = v.s === 'note' ? v.id : v.s === 'asset' ? v.list[assetIndex(v)] : undefined
    const group = v.s === 'group' ? lib().groupBy.get(v.id) : undefined
    const list: NavMenuItem[] | undefined =
      v.s === 'project'
        ? lib().projects.map((pr) => ({ id: pr.name, icon: 'project', label: pr.name, current: v.name === pr.name }))
        : v.s === 'tag'
          ? [...lib().tagGroups().keys()]
              .toSorted((a, b) => a.localeCompare(b, 'ja'))
              .map((t) => ({ id: t, icon: 'hash', label: t, current: v.tag === t }))
          : group
            ? lib()
                .groupsIn({ project: group.project, group: group.parent })
                .map((g) => ({ id: g.id, icon: 'group', label: g.name, current: g.id === group.id }))
            : siblingItems(v)?.map((it) => ({
                id: it.id,
                icon: it.note ? 'note' : 'file',
                label: it.name,
                current: it.id === here,
              }))
    return list?.toSorted((a, b) => Number(!!b.current) - Number(!!a.current))
  }
  const toSibling = (i: number, id: string) => {
    const v = stack()[i]
    if (!v) return
    const to: View | undefined =
      v.s === 'project'
        ? { s: 'project', name: id }
        : v.s === 'tag'
          ? { s: 'tag', tag: id }
          : v.s === 'group'
            ? { s: 'group', id }
            : itemView(
                id,
                siblingItems(v)?.map((it) => it.id),
              )
    if (to) setStack([...stack().slice(0, i), to])
  }
  const [peek, setPeek] = createSignal<string>()
  const [peekUrl, setPeekUrl] = createSignal<string>()
  const [barTools, setBarTools] = createSignal<HTMLElement>()
  const openRef = (id: string) => {
    const how = prefs().openLink
    if (inNewTab() || how === 'here') openItem(id)
    else if (how === 'tab') asNewTab(() => openItem(id))
    else if (lib().byId.has(id)) {
      setPeekUrl(undefined)
      setPeek(id)
    }
  }
  /** URL の埋め込み。素材のリンクと同じく、開き方の設定に合わせる。 */
  const openPage = (url: string) => {
    const how = prefs().openLink
    if (inNewTab() || how === 'here') go({ s: 'web', url })
    else if (how === 'tab') asNewTab(() => go({ s: 'web', url }))
    else {
      setPeek(undefined)
      setPeekUrl(url)
    }
  }
  const webScreen = (url: string) => (
    <WebScreen
      url={url}
      browser={backend.browser}
      onOpenDefault={backend.openUrl && ((u) => void backend.openUrl?.(u).catch(fail))}
    />
  )
  createEffect(() => {
    stack()
    setPeek(undefined)
    setPeekUrl(undefined)
    selection.clear()
  })
  const onGo = (to: Place) => {
    const screen = screens().find((s) => screenStart(s.plugin, s.id) === to)
    if (screen) setStack([{ s: 'screen', plugin: screen.plugin, id: screen.id }])
    else if (to === 'tidy') go({ s: 'tidy' })
    else setStack([{ s: to === 'all' ? 'all' : to === 'tags' ? 'tlist' : to === 'projects' ? 'plist' : 'edition' }])
  }

  const fail = (e: unknown) => {
    notify(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
  const failLoad = (e: unknown) => {
    notify(`読み込めませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
  const persist = (job: () => Promise<void>) => queueJob(job, fail)
  const state = (): LibraryState => ({
    pins: lib().pins,
    pinnedProjects: pinnedProjects(),
    pinnedTags: pinnedTags(),
  })
  const saveState = () => {
    const s = state()
    persist(() => backend.saveState(s))
  }
  // 文章が外で変わっていて書かなかったときは、読み直したものに替える。書けなかったときは元に戻す
  const editItem = (id: string, change: Partial<Item>, patch: ItemPatch) => {
    const it = lib().byId.get(id)
    if (!it) return
    const undo: Partial<Item> = Object.fromEntries(Object.entries(it).filter(([k]) => k in change))
    changeFile(id, change, undo, async () => {
      const read = await backend.saveItem(id, patch)
      if (read) notify('外で変更されたので読み込み直しました', 'info')
      return read
    })
  }
  const [recentTags, setRecentTags] = createSignal<string[]>([])
  onMount(() => void backend.tagHistory?.().then(setRecentTags, failLoad))
  const OPENED = 20
  const [opened, setOpened] = createSignal<string[]>([])
  // 読み終える前に開いたものは、先頭に残す
  onMount(
    () =>
      void backend
        .openHistory?.()
        .then((ids) => setOpened([...new Set([...opened(), ...ids])].slice(0, OPENED)), failLoad),
  )
  let saveOpened: ReturnType<typeof setTimeout> | undefined
  // 素材を送って見るたびに書かないよう、少し待ってから残す
  createEffect(() => {
    const v = stack().at(-1)
    const id = v?.s === 'note' ? v.id : v?.s === 'asset' ? v.list[assetIndex(v)] : undefined
    const list = untrack(opened)
    if (!id || list[0] === id) return
    const next = [id, ...list.filter((x) => x !== id)].slice(0, OPENED)
    setOpened(next)
    clearTimeout(saveOpened)
    saveOpened = setTimeout(() => persist(async () => backend.saveOpenHistory?.(next)), 1000)
  })
  onCleanup(() => clearTimeout(saveOpened))
  const tagItem = (id: string, tag: string, on: boolean) => {
    const tags = lib().byId.get(id)?.tags ?? []
    if (on) {
      const next = [tag, ...recentTags().filter((t) => t !== tag)].slice(0, 8)
      setRecentTags(next)
      persist(async () => backend.saveTagHistory?.(next))
    }
    editItem(
      id,
      { tags: on ? [...tags, tag] : tags.filter((t) => t !== tag) },
      { tags: on ? { add: [tag] } : { remove: [tag] } },
    )
  }
  const setAliases = (id: string, aliases: string[]) => {
    const old = lib().byId.get(id)?.aliases ?? []
    editItem(
      id,
      { aliases },
      { aliases: { add: aliases.filter((a) => !old.includes(a)), remove: old.filter((a) => !aliases.includes(a)) } },
    )
  }
  // 先に画面を変えておき、ファイルを変えられなかったら元に戻す
  const changeFile = (id: string, change: Partial<Item>, undo: Partial<Item>, run: () => Promise<Item | undefined>) => {
    const put = (c: Partial<Item>) => {
      const now = lib().byId.get(id)
      if (now) setLib(withChanged(lib(), [{ ...now, ...c }], []))
    }
    put(change)
    persist(async () => {
      try {
        const done = await run()
        if (done) setLib(withChanged(lib(), [done], []))
      } catch (e) {
        put(undo)
        throw e
      }
    })
  }
  const moveItem = (id: string, to: ItemPlace) => {
    const it = lib().byId.get(id)
    if (it && !samePlace(it, to)) changeFile(id, { ...to }, placeOf(it), () => backend.moveItem(id, to))
  }
  // 1 件ずつ動かし、動かせなかったものは元に戻して名前を知らせる
  const moveItems = (ids: string[], to: ItemPlace) => {
    const its = ids.flatMap((id) => lib().byId.get(id) ?? []).filter((it) => !samePlace(it, to))
    if (its.length <= 1) {
      if (its[0]) moveItem(its[0].id, to)
      return
    }
    setLib(
      withChanged(
        lib(),
        its.map((it) => ({ ...it, ...to })),
        [],
      ),
    )
    selection.clear()
    persist(async () => {
      const failed: Item[] = []
      for (const it of its) {
        try {
          const done = await backend.moveItem(it.id, to)
          if (done) setLib(withChanged(lib(), [done], []))
        } catch {
          const now = lib().byId.get(it.id)
          if (now) setLib(withChanged(lib(), [{ ...now, ...placeOf(it) }], []))
          failed.push(it)
        }
      }
      const place = `「${lib().placeName(to) ?? '所属なし'}」へ`
      const moved = its.length - failed.length
      if (failed.length)
        notify(
          `${moved ? `${moved} 件を${place}移しました。` : ''}${namesOf(failed)}は、同じ名前のファイルがあるなどで移せませんでした`,
          'error',
        )
      else notify(`${moved} 件を${place}移しました`, 'success')
    })
  }
  const approveTags = (id: string, d: TidyDecision) => {
    const it = lib().byId.get(id)
    if (!it) return
    const add = d.tags.filter((t) => !it.tags.includes(t))
    if (add.length) editItem(id, { tags: [...it.tags, ...add] }, { tags: { add } })
    if (d.project !== it.project) moveItem(id, { project: d.project, group: null })
    const decisions = backend.tagDecisions
    if (decisions) persist(() => decisions.record(id, d.tags, d.rejected))
  }
  const undoTags = (before: Item) => {
    const it = lib().byId.get(before.id)
    if (!it) return
    const remove = it.tags.filter((t) => !before.tags.includes(t))
    if (remove.length) editItem(it.id, { tags: before.tags }, { tags: { remove } })
    moveItem(it.id, placeOf(before))
    const decisions = backend.tagDecisions
    if (decisions) persist(() => decisions.undo(it.id))
  }
  const tagItems = (ids: string[], tag: string, on: boolean) => {
    for (const id of ids) if (lib().byId.get(id)?.tags.includes(tag) !== on) tagItem(id, tag, on)
  }
  const renameItem = (id: string, name: string) => {
    const it = lib().byId.get(id)
    if (it && it.name !== name) changeFile(id, { name }, { name: it.name }, () => backend.renameItem(id, name))
  }

  const withoutItem = (vs: View[], id: string) =>
    vs.flatMap((v): View[] => {
      if (v.s === 'note') return v.id === id ? [] : [v]
      if (v.s !== 'asset' || !v.list.includes(id)) return [v]
      const at = assetIndex(v)
      const list = v.list.filter((x) => x !== id)
      if (!list.length) return []
      const cur = v.list[at]
      return [{ ...v, list, index: cur === id ? Math.min(at, list.length - 1) : list.indexOf(cur ?? '') }]
    })
  // 先に頼んだ保存が、ごみ箱に移動したあとでメタ情報を書き直さないよう、保存と同じ順番に並べる
  /** 消えた項目を、タブ・Peek・選択から外す。 */
  const forget = (ids: string[]) => {
    for (const id of ids) {
      eachStack((s) => {
        const rest = withoutItem(s, id)
        return rest.length ? rest : [{ s: 'edition' }]
      })
      if (peek() === id) setPeek(undefined)
    }
    selection.set(selection.ids().filter((id) => lib().byId.has(id)))
  }
  const deleteItems = (ids: string[]) => {
    const del = backend.deleteItem
    const its = ids.flatMap((id) => lib().byId.get(id) ?? [])
    if (!del || !its.length) return
    persist(async () => {
      const failed: { it: Item; e: unknown }[] = []
      let pinned = false
      for (const it of its) {
        try {
          await del(it.id)
        } catch (e) {
          failed.push({ it, e })
          continue
        }
        pinned ||= lib().pins.includes(it.id)
        setLib(withChanged(lib(), [], [it.id]))
        forget([it.id])
      }
      if (pinned) saveState()
      const done = its.length - failed.length
      const one = its.length === 1 ? its[0] : undefined
      if (one && failed[0]) notify(`削除に失敗しました：${messageOf(failed[0].e)}`, 'error')
      else if (one) notify(`「${one.name}」をごみ箱に移動しました`, 'success')
      else if (failed.length)
        notify(
          `${done ? `${done} 件をごみ箱に移動しました。` : ''}${namesOf(failed.map((f) => f.it))}は削除できませんでした`,
          'error',
        )
      else notify(`${done} 件をごみ箱に移動しました`, 'success')
    })
  }
  const [deleting, setDeleting] = createSignal<string[]>()
  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => notify(done, 'success'),
      (e: unknown) => notify(`コピーに失敗しました：${messageOf(e)}`, 'error'),
    )
  const [menu, setMenu] = createSignal<MenuAt & { ids: string[] }>()
  const [menuPlugins, setMenuPlugins] = createSignal<MenuGroup[]>()
  // 選んでいないものを右クリックしたときは、選択を外してそれだけにかける
  const openMenu = (id: string, at: MenuAt) => {
    if (at.anchor && menu()?.anchor === at.anchor) {
      setMenu(undefined)
      return
    }
    const ids = selection.has(id) ? selection.ids() : [id]
    if (!selection.has(id)) selection.clear()
    const m = { ids, ...at }
    setMenu(m)
    setMenuPlugins(undefined)
    if (!backend.itemMenu) return
    backend.itemMenu(ids).then(
      (es) => menu() === m && setMenuPlugins(es),
      (e: unknown) => console.warn('プラグインのメニューを読めない', e),
    )
  }
  const [menuResult, setMenuResult] = createSignal<{ title: string; rows: { label: string; value: string }[] }>()
  const runPlugin = (ids: string[], plugin: string, entry: string) => {
    const label = menuPlugins()
      ?.find((g) => g.plugin === plugin)
      ?.items.find((e) => e.id === entry)?.label
    return backend.runItemMenu?.(ids, plugin, entry).then(
      (r) => {
        if (r.items.length) setLib(withChanged(lib(), r.items, []))
        if (r.copy !== undefined)
          navigator.clipboard
            .writeText(r.copy)
            .catch((e: unknown) => notify(`コピーに失敗しました：${messageOf(e)}`, 'error'))
        if (r.failed.length) {
          console.warn('プラグインが頼んだ処理のうち、できなかったもの', r.failed)
          notify(`プラグインの処理の一部に失敗しました：${r.failed[0]}`, 'error')
        } else if (r.output && 'toast' in r.output) notify(r.output.toast, r.output.level ?? 'info')
        else if (r.saved) notify(`「${r.saved}」に書き出しました`, 'success')
        if (r.output && 'overlay' in r.output)
          setMenuResult({ title: r.output.overlay.title ?? label ?? 'プラグインの結果', rows: r.output.overlay.rows })
        if (r.output && 'screen' in r.output) {
          const { id, window } = r.output.screen
          const s = screens().find((x) => x.plugin === plugin && x.id === id)
          if (s) void openScreen(s, ids, window === true).catch(fail)
          else notify(`プラグインの画面「${id}」が見つかりません`, 'error')
        }
      },
      (e: unknown) => notify(`プラグインの処理に失敗しました：${messageOf(e)}`, 'error'),
    )
  }
  const allTags = () => [...lib().tagGroups().keys()].toSorted((x, y) => x.localeCompare(y, 'ja'))

  const createProject = async () => {
    const name = newProjectName(lib())
    try {
      setLib(withProject(lib(), await backend.createProject(name)))
      go({ s: 'project', name, editing: true })
    } catch (e) {
      fail(e)
    }
  }
  const addNote = async (name: string | undefined, place: ItemPlace) => {
    try {
      const it = await backend.createNote(newNoteName(lib(), name), place)
      setLib(withItem(lib(), it))
      return it
    } catch (e) {
      fail(e)
      return undefined
    }
  }
  const createNote = async (name?: string) => {
    const it = await addNote(name, ROOT)
    if (it) go({ s: 'note', id: it.id })
  }
  const addNoteWith = async (n: NewNote) => {
    const it = await addNote(n.name, { project: n.project ?? null, group: null })
    if (it && n.body) editItem(it.id, { body: n.body }, { body: n.body })
    return it
  }
  const setTags = (id: string, tags: string[]) => {
    const old = lib().byId.get(id)?.tags ?? []
    const add = tags.filter((t) => !old.includes(t))
    const remove = old.filter((t) => !tags.includes(t))
    if (add.length || remove.length) editItem(id, { tags }, { tags: { add, remove } })
  }
  const openWith = (opts: OpenOptions | undefined, open: () => void) => (opts?.newTab ? asNewTab(open) : open())
  const pluginScreen = (v: View & { s: 'screen' }) => {
    const s = screenOfView(v)
    return (
      <PluginScreen
        lib={lib()}
        url={s && backend.uiUrl?.(s)}
        screen={v.id}
        targets={v.targets ?? []}
        label={s?.label ?? LABEL.screen}
        own={backend.ownApi?.(v.plugin) ?? NO_OWN}
        onOpen={(id, o) => openWith(o, () => openItem(id))}
        onOpenTag={(tag, o) => openWith(o, () => go({ s: 'tag', tag }))}
        onOpenProject={(name, o) => openWith(o, () => go({ s: 'project', name }))}
        onCreateNote={addNoteWith}
        onBody={(id, body) => editItem(id, { body }, { body })}
        onTags={setTags}
        onRename={renameItem}
      />
    )
  }
  /** 画面のウィンドウ（label → 出しているもの）。ライブラリはこちらが持ち、ウィンドウには写しを送る。 */
  const screenWins = new Map<string, { screen: ScreenInfo; targets: string[] }>()
  const pinSet = createMemo(() => new Set(lib().pins))
  const windowItems = () => lib().items.map((it) => libraryItemOf(it, pinSet()))
  const sendState = (label: string) => {
    const w = screenWins.get(label)
    if (!w) return
    const ws: WindowState = {
      plugin: w.screen.plugin,
      screen: w.screen.id,
      label,
      url: backend.uiUrl?.(w.screen) ?? '',
      items: windowItems(),
      targets: w.targets,
    }
    void backend.screenWindows?.send(label, STATE, ws)
  }
  /** 別のウィンドウで開けないときは、タブで開く。 */
  const openScreen = async (s: ScreenInfo, targets: string[], inWindow: boolean) => {
    const sw = backend.screenWindows
    if (!inWindow || !sw) {
      go({ s: 'screen', plugin: s.plugin, id: s.id, ...(targets.length && { targets }) })
      return
    }
    const { label, existed } = await sw.open(s)
    screenWins.set(label, { screen: s, targets })
    if (existed) sendState(label)
  }
  createEffect(() => {
    lib()
    untrack(() => {
      if (!screenWins.size) return
      const items = windowItems()
      for (const label of screenWins.keys()) void backend.screenWindows?.send(label, ITEMS, items)
    })
  })
  const needItem = (id: string) => {
    const it = lib().byId.get(id)
    if (!it) throw new Error(`項目「${id}」が見つかりません`)
    return it
  }
  const toFront = (o: OpenOptions | undefined, open: () => void) => {
    openWith(o, open)
    backend.screenWindows?.focusMain()
  }
  const windowCall = async (plugin: string, c: WindowCall): Promise<Omit<Reply, 'req'>> => {
    const own = backend.ownApi?.(plugin) ?? NO_OWN
    switch (c.method) {
      case 'settings':
        return { settings: await own.settings() }
      case 'getData':
        return { data: await own.getData(c.args[0]) }
      case 'setSetting':
        await own.setSetting(c.args[0], c.args[1])
        break
      case 'setData':
        await own.setData(c.args[0], c.args[1] ?? undefined)
        break
      case 'open':
        toFront(c.args[1], () => openItem(needItem(c.args[0]).id))
        break
      case 'openTag':
        toFront(c.args[1], () => go({ s: 'tag', tag: c.args[0] }))
        break
      case 'openProject': {
        const [name, o] = c.args
        if (!lib().projectBy.has(name)) throw new Error(`プロジェクト「${name}」が見つかりません`)
        toFront(o, () => go({ s: 'project', name }))
        break
      }
      case 'createNote': {
        const n = c.args[0]
        if (n.project != null && !lib().projectBy.has(n.project))
          throw new Error(`プロジェクト「${n.project}」が見つかりません`)
        const it = await addNoteWith(n)
        if (!it) throw new Error('ノートを作成できませんでした')
        return { item: libraryItemOf(lib().byId.get(it.id) ?? it, pinSet()) }
      }
      case 'setBody': {
        const [id, body] = c.args
        if (!needItem(id).note) throw new Error('ノートではありません')
        editItem(id, { body }, { body })
        break
      }
      case 'setTags':
        needItem(c.args[0])
        setTags(c.args[0], c.args[1])
        break
      case 'rename':
        needItem(c.args[0])
        renameItem(c.args[0], c.args[1])
        break
    }
    return {}
  }
  const onWindow = (m: FromWindow) => {
    const w = screenWins.get(m.label)
    if (!w) return
    if (m.kind === 'closed') {
      screenWins.delete(m.label)
      return
    }
    if (m.kind === 'ready') {
      sendState(m.label)
      return
    }
    const reply = (r: Omit<Reply, 'req'>) => void backend.screenWindows?.send(m.label, REPLY, { req: m.req, ...r })
    windowCall(w.screen.plugin, m).then(reply, (e: unknown) => reply({ error: messageOf(e) }))
  }
  onMount(() => {
    const off = backend.screenWindows?.listen(onWindow)
    if (off) onCleanup(off)
  })
  const embedHost = () => ({
    format: (ext: string) => lib().formats.get(ext),
    view: backend.itemView,
    waveform: backend.waveform,
    ui: backend.uiApi,
    uiUrl: backend.uiUrl,
    linkOf: backend.linkOf,
  })
  const embedOf = (it: Item) => embedFor(it, embedHost())
  const urlPreviewOf = async (url: string): Promise<UrlPreview> => {
    const [page, thumb] = await Promise.all([
      backend
        .linkOf?.(url, 'details')
        .page()
        .catch(() => undefined),
      backend.linkThumb?.(url).catch(() => undefined),
    ])
    return { title: page?.title, thumb }
  }
  /** 設定に合わせて、内蔵ブラウザ（新しい画面）か既定のアプリで開く。 */
  const openUrl = async (url: string) => {
    const s = await backend.appSettings?.get().catch(() => undefined)
    if (s?.linkOpen === 'builtin' || !backend.openUrl) go({ s: 'web', url })
    else await backend.openUrl(url).catch(fail)
  }
  const renameTag = (from: string, to: string, keepFrom = false) => {
    const re = retag(from, to)
    setLib(withRenamedTag(lib(), from, to, keepFrom))
    setPinnedTags([...new Set(pinnedTags().map(re))])
    eachStack((s) => s.map((v) => (v.s === 'tag' ? { ...v, tag: re(v.tag) } : v)))
    persist(() => backend.renameTag(from, to, keepFrom))
    saveState()
  }
  const [merging, setMerging] = createSignal<{ from: string; to: string }>()
  // すでにあるタグの名前に変えるときは、マージするか別の名前にするかを聞く
  const requestRenameTag = (from: string, to: string) => {
    if (tagClash(lib(), from, to).clash) {
      setMerging({ from, to })
    } else {
      setMerging(undefined)
      renameTag(from, to)
    }
  }
  const saveTagCover = (tag: string, cover: TagCoverPart[]) => {
    setLib(withTagCover(lib(), tag, cover))
    persist(() => backend.saveTagCover(tag, cover))
  }
  const deleteTagCover = (tag: string) => {
    setLib(withTagCover(lib(), tag))
    persist(() => backend.deleteTagCover(tag))
  }
  // 概要のあるタグが、どの項目にも付かなくなったら、概要を削除するか聞く
  const [goneTags, setGoneTags] = createSignal<string[]>([])
  const nextGoneTag = () => setGoneTags(goneTags().slice(1))
  let tagsBefore = lib()
  createEffect(() => {
    const now = lib()
    const before = tagsBefore
    tagsBefore = now
    const had = tagsUsed(before)
    const has = tagsUsed(now)
    const gone = [...now.tagCovers.keys()].filter((t) => !has.has(t) && had.has(t))
    if (gone.length) setGoneTags((g) => [...new Set([...g, ...gone])])
  })
  const saveProjectCover = (name: string, cover: CoverPart[]) => {
    setLib(withProjectCover(lib(), name, cover))
    persist(() => backend.saveProject(name, cover))
  }
  const renameProject = (from: string, to: string) => {
    const rename = backend.renameProject
    if (!rename) return
    if (lib().projectBy.has(to)) {
      notify(`プロジェクト「${to}」はすでに存在します`, 'error')
      return
    }
    persist(async () => {
      await rename(from, to)
      setLib(withRenamedProject(lib(), from, to))
      setPinnedProjects(pinnedProjects().map((n) => (n === from ? to : n)))
      eachStack((s) => s.map((v) => (v.s === 'project' && v.name === from ? { s: 'project', name: to } : v)))
      saveState()
    })
  }
  const deleteProject = (name: string) => {
    const del = backend.deleteProject
    if (!del) return
    persist(async () => {
      await del(name)
      setLib(withoutProject(lib(), name))
      setPinnedProjects(pinnedProjects().filter((n) => n !== name))
      eachStack((s) => {
        const rest = s.filter((v) => !(v.s === 'project' && v.name === name))
        return rest.length ? rest : [{ s: 'edition' }]
      })
      saveState()
      notify(`プロジェクト「${name}」を削除し、中身を所属なしに移動しました`, 'success')
    })
  }
  const [orphans, setOrphans] = createSignal(props.orphans ?? [])
  const [orphansHeld, setOrphansHeld] = createSignal(false)
  const settleOrphan = (meta: string, job?: () => Promise<void>) => {
    if (!job) return
    setOrphans(orphans().filter((o) => o.meta !== meta))
    persist(job)
  }
  const chooseLibrary =
    backend.chooseLibrary &&
    (async () => {
      try {
        await flushWrites()
        if (await backend.chooseLibrary?.()) window.location.reload()
      } catch (e) {
        notify(`ライブラリを切り替えられませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    })
  const [plugged, setPlugged] = createSignal(0)
  const [reloading, setReloading] = createSignal<{ step: 'ask' | 'wait' | 'load'; work?: number }>()
  let answer: ((a: 'wait' | 'stop') => void) | undefined
  const reloadPlugins = async () => {
    if (!backend.reloadPlugins) {
      reload()
      return
    }
    if (reloading()) return
    const work = workCount(await backend.pluginWork?.())
    let wait = true
    if (work > 0) {
      setReloading({ step: 'ask', work })
      const a = await new Promise<'wait' | 'stop'>((r) => (answer = r))
      answer = undefined
      wait = a === 'wait'
    }
    setReloading({ step: wait && work > 0 ? 'wait' : 'load' })
    const poll = window.setInterval(() => {
      if (reloading()?.step === 'wait')
        void backend
          .pluginWork?.()
          .then((w) => reloading()?.step === 'wait' && setReloading({ step: 'wait', work: workCount(w) }))
    }, 500)
    try {
      const o = await backend.reloadPlugins(wait)
      setLib(suggestions ? withSuggestions(o.lib, suggestions) : o.lib)
      setScreens(o.screens ?? [])
      setPinnedProjects(o.pinnedProjects)
      setPinnedTags(o.pinnedTags)
      setPlugged(plugged() + 1)
      if (o.problems.length) {
        console.warn('読めなかったもの', o.problems)
        notify(`${o.problems.length} 件を読み込めませんでした`, 'error')
      }
    } catch (e) {
      notify(`プラグインの読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      clearInterval(poll)
      setReloading(undefined)
    }
  }
  // 前に開いていたタブを戻してから、変わるたびに書き出す
  const [tabsRead, setTabsRead] = createSignal(!backend.tabs)
  const firstTab = tabs()[0]
  const firstStack = firstTab?.stack()
  const sameView = (a: View | undefined, b: View) => JSON.stringify(a) === JSON.stringify(b)
  const restoreTabs = (s: SavedTabs | undefined) => {
    const made = (Array.isArray(s?.tabs) ? s.tabs : [])
      .map((vs) =>
        (Array.isArray(vs) ? vs : []).reduce<View[]>((out, v) => {
          const read = viewOf(lib(), screens(), v, out.at(-1))
          return read ? [...out, read] : out
        }, []),
      )
      .map((vs) => (vs.length ? makeTab(vs) : undefined))
    const list = made.flatMap((t) => t ?? [])
    const at = typeof s?.current === 'number' ? s.current : 0
    const shown = made[at] ?? list[Math.min(Math.max(0, at), list.length - 1)]
    if (!shown) return
    const used = new Set<number>()
    const groups = (Array.isArray(s?.splits) ? s.splits : []).flatMap((v) => {
      const n = parseSplit(v, (i) => made[i]?.id)
      if (!n || 'tab' in n || leaves(n).some((id) => used.has(id))) return []
      for (const id of leaves(n)) used.add(id)
      return [n]
    })
    // 読み終える前にタブを操作していたら、そのタブは後ろに残して、表に出したままにする
    const touched = tabs().length > 1 || currentTab() !== firstTab || firstTab?.stack() !== firstStack
    batch(() => {
      if (touched) {
        setLayout([...list, ...tabs()], [...groups, ...splits()])
        return
      }
      setLayout(list, groups)
      setCurrentTab(shown)
      const home = startView()
      if (prefs().start !== 'last' && !sameView(shown.stack().at(-1), home)) shown.setStack([...shown.stack(), home])
    })
  }
  onMount(
    () =>
      void backend
        .tabs?.()
        .then(restoreTabs, failLoad)
        .finally(() => setTabsRead(true)),
  )
  // 素材の前後の並びは数千件になることがあるので書かず、開き直すときに来た画面から作り直す
  const savedView = (v: View): unknown =>
    v.s === 'asset'
      ? { s: 'asset', id: v.list[assetIndex(v)] }
      : v.s === 'project'
        ? { s: 'project', name: v.name }
        : v.s === 'tidy'
          ? { s: 'tidy' }
          : v
  createEffect(() => {
    const s: SavedTabs = {
      tabs: tabs().map((t) => t.stack().map(savedView)),
      current: tabs().indexOf(currentTab()),
      splits: splits().map((n) => savedSplit(n, (id) => tabs().findIndex((t) => t.id === id))),
    }
    const save = backend.saveTabs
    if (tabsRead() && save) persist(() => save(s))
  })
  const [barRequest, setBarRequest] = createSignal<BarRequest>()
  const blockerOf = async (ext: string): Promise<Blocker | undefined> => {
    const report = await backend.plugins()
    const clash = report.conflicts?.find((c) => c.ext === ext)
    const clashing = clash && report.plugins.filter((p) => clash.plugins.includes(p.id))
    const [first] = clashing ?? []
    if (clashing && first) return { ...first, conflict: clashing.map((p) => p.name) }
    const of = report.plugins.filter((p) => p.formats.includes(ext))
    return (
      of.find((p) => p.state === 'disabled' && !p.dev) ??
      of.find((p) => p.state === 'disabled') ??
      of.find((p) => p.state === 'blocked')
    )
  }
  const setEnabled = backend.pluginActions?.setEnabled
  const enablePlugin =
    setEnabled &&
    (async (p: Blocker) => {
      await setEnabled(p.id, p.dev, true)
      await reloadPlugins()
    })
  const viewHost = backend.itemView && {
    view: backend.itemView,
    ui: backend.uiApi,
    waveform: backend.waveform,
    details: backend.itemDetails,
    linkOf: backend.linkOf,
    browser: backend.browser,
    openUrl: backend.openUrl && ((url: string) => void backend.openUrl?.(url).catch(fail)),
    openLink: (url: string) => void openUrl(url),
  }
  const { uiApi, uiUrl } = backend
  const hoverHost: HoverHost = {
    ui:
      uiApi &&
      uiUrl &&
      ((it, ui) => ({
        url: uiUrl(ui),
        api: uiApi({ id: it.id, name: it.name, ext: it.ext, url: it.src }, 'hover', ui.plugin),
      })),
  }
  const togglePin = (id: string) => {
    setLib(withToggledPin(lib(), id))
    saveState()
  }
  const pinItems = (ids: string[], on: boolean) => {
    let next = lib()
    for (const id of ids) if (next.pins.includes(id) !== on) next = withToggledPin(next, id)
    setLib(next)
    saveState()
  }
  const toggleProjectPin = (name: string) => {
    setPinnedProjects(toggled(pinnedProjects(), name))
    saveState()
  }
  const toggleTagPin = (tag: string) => {
    setPinnedTags(toggled(pinnedTags(), tag))
    saveState()
  }
  const screenPlace = (v: View) => (v.s === 'screen' ? screenStart(v.plugin, v.id) : undefined)
  const screenPlaces = (): ScreenPlace[] =>
    screens()
      .filter((s) => s.place)
      .map((s) => ({ place: screenStart(s.plugin, s.id), label: s.label, icon: screenIcon(s) }))
  const here = (): Place | undefined =>
    view().s === 'edition'
      ? 'home'
      : view().s === 'all'
        ? 'all'
        : view().s === 'tlist'
          ? 'tags'
          : view().s === 'plist'
            ? 'projects'
            : view().s === 'screen'
              ? screenPlace(view())
              : undefined

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable || e.target.closest('input, textarea, select, [role="dialog"], [role="menu"]'))
    )
      return
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'u') {
      e.preventDefault()
      go({ s: 'tidy' })
    } else if (k === 'n' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void createNote()
    }
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  // サムネイルは 1 枚ずつ届くので、少し溜めてからまとめて付ける
  let thumbs = new Map<string, Thumbnail>()
  let flush = 0
  const stopThumbs = backend.onThumbnail((id, t) => {
    thumbs.set(id, t)
    flush ||= window.setTimeout(() => {
      setLib(withThumbs(lib(), thumbs))
      thumbs = new Map()
      flush = 0
    }, 150)
  })
  onCleanup(() => {
    stopThumbs()
    clearTimeout(flush)
  })

  let suggestions: Record<string, Suggestion> | undefined
  const stopSuggestions = backend.tagDecisions?.onSuggestions((s) => {
    suggestions = s.items
    setLib(withSuggestions(lib(), s.items))
    // 選択済みの候補がないものは、分類の確認に残す
    if (s.apply)
      for (const it of lib().pending()) {
        const tags = it.suggestion?.tags ?? []
        const chosen = tags.filter((t) => t.on).map((t) => t.tag)
        if (chosen.length)
          approveTags(it.id, {
            tags: chosen,
            rejected: tags.filter((t) => !t.on).map((t) => t.tag),
            project: it.project,
          })
      }
  })
  onCleanup(() => stopSuggestions?.())

  const stopChanged =
    backend.onChanged?.((c) => {
      const s = c.state
      const open = new Set(
        tabs().flatMap((t) => {
          const v = t.stack().at(-1)
          return v?.s === 'note' ? [v.id] : []
        }),
      )
      const rewritten = c.items.filter((it) => open.has(it.id) && it.body !== lib().byId.get(it.id)?.body)
      setLib(withChanged(lib(), c.items, c.removed, c.projects, c.tagCovers, s?.pins, c.groups))
      for (const it of rewritten) notify(`「${it.name}」が外で変更されたので読み込み直しました`, 'info')
      if (c.removed.length) forget(c.removed)
      if (s?.pinnedProjects) setPinnedProjects(s.pinnedProjects)
      if (s?.pinnedTags) setPinnedTags(s.pinnedTags)
      if (c.orphans) {
        setOrphans(c.orphans)
        setOrphansHeld(false)
      }
      if (c.problems.length) {
        console.warn('読めなかったもの', c.problems)
        notify(`${c.problems.length} 件を読み込めませんでした`, 'error')
      }
    }) ?? (() => {})
  onCleanup(stopChanged)

  const [drag, setDrag] = createSignal<Dropped>()
  const dropPlace = (): ItemPlace => {
    const v = view()
    if (v.s === 'project') return { project: v.name, group: null }
    const g = v.s === 'group' ? lib().groupBy.get(v.id) : undefined
    return g ? { project: g.project, group: g.id } : ROOT
  }
  const [importing, setImporting] = createSignal(0)
  const importDropped = async (place = dropPlace()) => {
    if (!backend.importDropped) return []
    setImporting(importing() + 1)
    try {
      const r = await backend.importDropped(place)
      if (r.failed.length) console.warn('取り込めなかったもの', r.failed)
      setLib(withAdded(lib(), r.items, [], r.groups))
      notify(importedNotice(r), r.failed.length ? 'error' : r.items.length ? 'success' : 'info')
      return r.items
    } catch (e) {
      notify(`取り込めませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
      return []
    } finally {
      setImporting(importing() - 1)
    }
  }
  const importFiles = async (files: File[], place: ItemPlace) => {
    const take = backend.importData
    if (!take) return []
    setImporting(importing() + 1)
    try {
      const done = await Promise.allSettled(files.map((f) => take(f, place)))
      const items = done.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const failed = done.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      if (failed.length) console.warn('取り込めなかったもの', failed)
      setLib(withAdded(lib(), items))
      if (failed.length) notify(`${failed.length} 件の取り込みに失敗しました`, 'error')
      return items
    } finally {
      setImporting(importing() - 1)
    }
  }
  const editors = new Map<number, NoteEditorApi>()
  const intoNote = () => {
    const v = view()
    const editor = editors.get(currentTab().id)
    return v.s === 'note' && editor && !peek() ? { editor, place: placeOf(lib().byId.get(v.id) ?? ROOT) } : undefined
  }
  const stopDrag =
    backend.onFileDrag?.((e) => {
      const into = intoNote()
      if (e.type === 'enter') setDrag(e.dropped)
      else if (e.type === 'over') into?.editor.dropAt(e)
      else if (e.type === 'drop') {
        setDrag(undefined)
        into?.editor.dropAt(undefined)
        if (!e.dropped.files) return
        const at = { x: e.x, y: e.y }
        if (into) void importDropped(into.place).then((items) => into.editor.insertItems(items, at))
        else void importDropped()
      } else if (e.type === 'leave') {
        setDrag(undefined)
        into?.editor.dropAt(undefined)
      }
    }) ?? (() => {})
  onCleanup(stopDrag)
  const making = progress()
  const waves = progress()
  const hooking = progress()
  const stopHookFailed =
    backend.onHookFailed?.((f) =>
      notify(`プラグイン「${f.plugin}」が、取り込んだ「${f.item}」を処理できませんでした：${f.message}`, 'error'),
    ) ?? (() => {})
  onCleanup(stopHookFailed)
  const seenThumbs = backend.seenThumbs && watchSeen((ids) => backend.seenThumbs?.(ids))
  const [checking, setChecking] = createSignal(false)
  if (backend.pluginWork || backend.checking) {
    const poll = window.setInterval(() => {
      void backend.pluginWork?.().then((w) => {
        making.update(w.thumbnails)
        waves.update(w.waveforms)
        hooking.update(w.hooks)
      })
      void backend.checking?.().then(setChecking)
    }, 1000)
    onCleanup(() => clearInterval(poll))
  }
  const working = (key: string, icon: IconName, label: string, p: Progress, part: 'thumbnail' | 'waveform' | 'hook') =>
    p.ids().size
      ? [{ key, icon, label, done: p.done(), total: p.total(), onStop: () => void backend.stopPluginWork?.(part) }]
      : []
  const activities = (): Activity[] => [
    ...(checking() ? [{ key: 'check', icon: 'sync' as const, label: 'ライブラリの整合性を確認中' }] : []),
    ...working('thumbs', 'image', 'サムネイルを作成中', making, 'thumbnail'),
    ...working('waves', 'audio', '音声を解析中', waves, 'waveform'),
    ...working('hooks', 'plugin', '取り込んだものをプラグインで処理中', hooking, 'hook'),
    ...(importing() ? [{ key: 'import', icon: 'import' as const, label: 'ファイルを取り込み中' }] : []),
  ]
  const flatSub = () => {
    const f = lib().placeName(dropPlace())
    return f ? `ドロップして「${f}」に追加します` : 'ドロップして所属なしで取り込みます'
  }

  const noteScreen = (noteId: string, tab?: Tab) => (
    <NoteScreen
      lib={lib()}
      noteId={noteId}
      headsOpen={tab ? undefined : false}
      onOpenRef={openRef}
      onOpenTag={(tag) => go({ s: 'tag', tag })}
      onTogglePin={togglePin}
      onBody={(id, body) => editItem(id, { body }, { body })}
      onRename={renameItem}
      onMove={moveItem}
      onAliases={setAliases}
      onTag={tagItem}
      recentTags={recentTags()}
      suggestTags={backend.tagDecisions?.suggestTags}
      onCreateNote={addNote}
      embedOf={embedOf}
      urlEmbedOf={(url, image) => urlEmbedFor(url, embedHost(), image)}
      urlPreviewOf={urlPreviewOf}
      onOpenPage={openPage}
      onImport={backend.importData && importFiles}
      editorRef={tab ? (api) => (api ? editors.set(tab.id, api) : editors.delete(tab.id)) : undefined}
    />
  )
  const assetScreen = (list: string[], index: number, onIndex?: (i: number) => void, at?: number) => (
    <AssetScreen
      lib={lib()}
      list={list}
      index={index}
      startAt={at}
      onIndex={onIndex}
      onOpenNote={(id) => openItem(id)}
      onOpenTag={(tag) => go({ s: 'tag', tag })}
      onTogglePin={togglePin}
      onMove={moveItem}
      onRename={renameItem}
      onTag={tagItem}
      recentTags={recentTags()}
      suggestTags={backend.tagDecisions?.suggestTags}
      onMemo={(id, memo) => editItem(id, { memo }, { memo })}
      host={viewHost}
      blocker={blockerOf}
      onEnablePlugin={enablePlugin}
      onOpenPlugins={(p) => setBarRequest({ state: 'plugins', plugin: p && { id: p.id, dev: p.dev } })}
      onReveal={backend.revealItem}
      onOpenDefault={backend.openItemDefault}
    />
  )

  const [ignored, setIgnored] = createSignal<ReadonlySet<string>>(new Set())
  const ignore = (id: string) => setIgnored(new Set([...ignored(), id]))
  const broken = createMemo(() => {
    const open = new Set([
      ...tabs().flatMap((t) => {
        const v = t.stack().at(-1)
        return v?.s === 'note' ? [v.id] : []
      }),
      peek() ?? '',
    ])
    const l = lib()
    const skip = ignored()
    return l.items.flatMap((it) => {
      if (!it.note || open.has(it.id) || skip.has(it.id)) return []
      const lost = new Set(noteRefs(it).filter((id) => !l.byId.has(id)))
      return lost.size ? [{ note: it, lost: lost.size }] : []
    })
  })
  const brokenNotice = () => {
    const [b, ...rest] = broken()
    if (!b) return undefined
    const more = rest.length ? `（ほか ${rest.length} 件のノートにもあります）` : ''
    return (
      <Toast
        level="warning"
        message={`「${b.note.name}」に、見つからないリンクが ${b.lost} 件あります${more}`}
        actionLabel="修正"
        onAction={() => {
          ignore(b.note.id)
          openItem(b.note.id)
        }}
        onClose={() => ignore(b.note.id)}
        closeLabel="無視"
      />
    )
  }

  const [report] = createResource(plugged, () => backend.plugins().catch(() => undefined))
  const [ignoredClash, setIgnoredClash] = createSignal<ReadonlySet<string>>(new Set())
  const clashes = createMemo(() => {
    const r = report()
    return (r?.conflicts ?? []).flatMap((c) => {
      if (ignoredClash().has(c.ext)) return []
      const by = r?.plugins.filter((p) => c.plugins.includes(p.id)) ?? []
      return by.length ? [{ ext: c.ext, by }] : []
    })
  })
  const clashNotice = () => {
    const [c, ...rest] = clashes()
    if (!c) return undefined
    const skip = () => setIgnoredClash(new Set([...ignoredClash(), c.ext]))
    const names = c.by.map((p) => `「${p.name}」`).join('')
    const more = rest.length ? `（ほか ${rest.length} 件の形式にもあります）` : ''
    const [first] = c.by
    return (
      <Toast
        level="warning"
        message={`「.${c.ext}」に複数のプラグイン（${names}）が対応しているため、使用していません${more}`}
        actionLabel="修正"
        onAction={() => {
          skip()
          setBarRequest({ state: 'plugins', plugin: first && { id: first.id, dev: first.dev } })
        }}
        onClose={skip}
        closeLabel="無視"
      />
    )
  }

  const screenOf = (tab: Tab) => {
    const shown = (): View => tab.stack().at(-1) ?? { s: 'edition' }
    return (
      <Switch>
        <Match when={shown().s === 'edition'}>
          <EditionScreen
            lib={lib()}
            location={props.location}
            pinnedProjects={pinnedProjects()}
            pinnedTags={pinnedTags()}
            onOpenItem={(id) => openItem(id)}
            onOpenProject={(name) => go({ s: 'project', name })}
            onOpenTag={(tag) => go({ s: 'tag', tag })}
            onTidy={(id) => go({ s: 'tidy', id })}
          />
        </Match>
        <Match when={shown().s === 'all'}>
          <AllScreen lib={lib()} onOpenItem={openItem} onOpenGroup={openGroup} onTogglePin={togglePin} />
        </Match>
        <Match when={shown().s === 'project' && shown()} keyed>
          {(v) =>
            v.s === 'project' && (
              <ProjectScreen
                lib={lib()}
                name={v.name}
                editing={v.editing}
                pinned={pinnedProjects().includes(v.name)}
                onTogglePin={togglePin}
                onToggleProjectPin={() => toggleProjectPin(v.name)}
                onSaveCover={(cover) => saveProjectCover(v.name, cover)}
                onRename={backend.renameProject && ((to) => renameProject(v.name, to))}
                onDelete={backend.deleteProject && (() => deleteProject(v.name))}
                onOpenItem={openItem}
                onOpenGroup={openGroup}
              />
            )
          }
        </Match>
        <Match when={shown().s === 'group' && shown()} keyed>
          {(v) =>
            v.s === 'group' && (
              <GroupScreen
                lib={lib()}
                id={v.id}
                onTogglePin={togglePin}
                onOpenItem={openItem}
                onOpenGroup={openGroup}
              />
            )
          }
        </Match>
        <Match when={shown().s === 'plist'}>
          <ProjectListScreen
            lib={lib()}
            pinned={pinnedProjects()}
            onOpenProject={(name) => go({ s: 'project', name })}
            onCreate={createProject}
          />
        </Match>
        <Match when={shown().s === 'tlist'}>
          <TagListScreen lib={lib()} onOpenTag={(tag) => go({ s: 'tag', tag })} />
        </Match>
        <Match when={shown().s === 'tag' && shown()} keyed>
          {(v) =>
            v.s === 'tag' && (
              <TagScreen
                lib={lib()}
                tag={v.tag}
                pinned={pinnedTags().includes(v.tag)}
                onOpenItem={openItem}
                onOpenTag={(tag) => go({ s: 'tag', tag })}
                onTogglePin={togglePin}
                onToggleTagPin={() => toggleTagPin(v.tag)}
                onRename={(to) => requestRenameTag(v.tag, to)}
                onSaveCover={(cover) => saveTagCover(v.tag, cover)}
              />
            )
          }
        </Match>
        <Match when={shown().s === 'note' && shown()} keyed>
          {(v) => v.s === 'note' && noteScreen(v.id, tab)}
        </Match>
        <Match when={shown().s === 'asset' && shown()} keyed>
          {(v) =>
            v.s === 'asset' &&
            assetScreen(
              v.list,
              untrack(() => assetIndex(v)),
              (i) => assetIndexOf(v)[1](i),
              v.at,
            )
          }
        </Match>
        <Match when={shown().s === 'web' && shown()} keyed>
          {(v) => v.s === 'web' && webScreen(v.url)}
        </Match>
        <Match when={shown().s === 'screen' && shown()} keyed>
          {(v) => v.s === 'screen' && pluginScreen(v)}
        </Match>
        <Match when={shown().s === 'tidy' && shown()} keyed>
          {(v) =>
            v.s === 'tidy' && (
              <TidyScreen
                lib={lib()}
                currentId={v.id}
                recentTags={recentTags()}
                onOpenItem={(id) => openItem(id)}
                onApprove={(it, d) => approveTags(it.id, d)}
                onUndo={undoTags}
              />
            )
          }
        </Match>
      </Switch>
    )
  }

  return (
    <FormatsProvider value={() => lib().formats}>
      <ThumbMakingProvider value={(id) => making.ids().has(id) || waves.ids().has(id)}>
        <ThumbSeenProvider value={seenThumbs}>
          <ItemMenuProvider value={{ open: openMenu, anchor: () => menu()?.anchor }}>
            <SelectionProvider value={selection}>
              <HoverHostProvider value={hoverHost}>
                <ScreenFrame
                  bar={
                    <AppBar
                      lib={lib()}
                      here={here()}
                      crumbs={crumbs()}
                      selected={selection.ids().length}
                      onCrumb={(i) => setStack(stack().slice(0, i + 1))}
                      siblingsOf={siblingsOf}
                      onSibling={toSibling}
                      onGo={onGo}
                      onOpenProject={(name) => go({ s: 'project', name })}
                      onOpenGroup={openGroup}
                      onOpenTag={(tag) => go({ s: 'tag', tag })}
                      onOpenItem={(id, at) => openItem(id, undefined, at)}
                      recent={opened()}
                      onCreate={createNote}
                      library={props.location}
                      onChooseLibrary={chooseLibrary}
                      libraries={backend.libraries}
                      tidy={backend.tidy}
                      developer={backend.developer}
                      appSettings={backend.appSettings}
                      autoTag={backend.autoTag}
                      contentSearch={backend.contentSearch}
                      onReopen={reload}
                      loadPlugins={() => backend.plugins()}
                      pluginActions={backend.pluginActions}
                      onPluginsChanged={reloadPlugins}
                      request={barRequest()}
                      activities={activities()}
                      tabs={tabsAt() === 'top' ? tabStrip() : undefined}
                      toolsRef={setBarTools}
                      screens={screenPlaces()}
                    />
                  }
                  side={tabsAt() === 'left' ? <TabList {...tabStrip()} /> : undefined}
                  toast={
                    (notice() || broken().length > 0 || clashes().length > 0) && (
                      <>
                        <Show when={notice()} keyed>
                          {(n) => (
                            <Toast
                              message={n.message}
                              level={n.level}
                              onClose={() => setNotice(undefined)}
                              autoClose={n.level === 'info' || n.level === 'success'}
                            />
                          )}
                        </Show>
                        {brokenNotice()}
                        {clashNotice()}
                      </>
                    )
                  }
                >
                  {/* プラグインを読み直したら、組み込み UI を描き直すため、いまの画面を作り直す */}
                  <For each={[plugged()]}>
                    {() => (
                      <For each={tabs()}>
                        {(t) => {
                          const rect = () => shownRects()?.get(t.id)
                          return (
                            <TabPane
                              active={t === currentTab()}
                              shown={t === currentTab() || !!rect()}
                              rect={rect()}
                              marked={!!rect() && t === currentTab()}
                              onFocus={() => rect() && setCurrentTab(t)}
                              onContextMenu={(e) => openPaneMenu(t, e)}
                            >
                              <BarToolsProvider value={barTools}>{screenOf(t)}</BarToolsProvider>
                            </TabPane>
                          )
                        }}
                      </For>
                    )}
                  </For>
                  <Show when={paneHint() !== undefined && shownRects()?.get(paneHint() ?? -1)}>
                    {(r) => <PaneHint rect={r()} />}
                  </Show>
                  <Show when={paneMenu()} keyed>
                    {(m) => (
                      <PaneMenu
                        x={m.x}
                        y={m.y}
                        moves={m.moves}
                        onPreview={setPaneHint}
                        onMove={(to) => movePane(m.tab, to)}
                        onClose={() => {
                          setPaneMenu(undefined)
                          setPaneHint(undefined)
                        }}
                      />
                    )}
                  </Show>
                  <Show when={shownSplit()}>
                    {(n) => (
                      <Seams
                        node={n()}
                        onSizes={(path, sizes) =>
                          setSplits(splits().map((x) => (x === n() ? withSizes(x, path, sizes) : x)))
                        }
                      />
                    )}
                  </Show>
                  <Show when={peek()}>
                    {(id) => (
                      <Peek
                        label={lib().byId.get(id())?.name ?? ''}
                        onExpand={() => {
                          const to = id()
                          setPeek(undefined)
                          const before = new Set(tabs())
                          asNewTab(() => openItem(to))
                          const t = tabs().find((x) => !before.has(x))
                          if (t) setCurrentTab(t)
                        }}
                        onSplit={(side) => {
                          const to = id()
                          setPeek(undefined)
                          openBeside(side, () => openItem(to))
                        }}
                        onClose={() => setPeek(undefined)}
                      >
                        <Show when={id()} keyed>
                          {(to) => (lib().byId.get(to)?.note ? noteScreen(to) : assetScreen([to], 0))}
                        </Show>
                      </Peek>
                    )}
                  </Show>
                  <Show when={peekUrl()} keyed>
                    {(url) => (
                      <Peek
                        label={hostOf(url) ?? url}
                        onExpand={() => {
                          setPeekUrl(undefined)
                          const before = new Set(tabs())
                          asNewTab(() => go({ s: 'web', url }))
                          const t = tabs().find((x) => !before.has(x))
                          if (t) setCurrentTab(t)
                        }}
                        onSplit={(side) => {
                          setPeekUrl(undefined)
                          openBeside(side, () => go({ s: 'web', url }))
                        }}
                        onOpenDefault={backend.openUrl && (() => void backend.openUrl?.(url).catch(fail))}
                        onClose={() => setPeekUrl(undefined)}
                      >
                        {webScreen(url)}
                      </Peek>
                    )}
                  </Show>
                  <Show when={reloading()}>
                    {(r) => (
                      <ReloadOverlay
                        step={r().step}
                        work={r().work}
                        onWait={() => answer?.('wait')}
                        onStop={() => (r().step === 'ask' ? answer?.('stop') : void backend.stopPluginWork?.())}
                      />
                    )}
                  </Show>
                  <Show when={!intoNote() && drag()}>
                    {(d) => (
                      <DropZone
                        title={d().files ? `${d().files} 件のファイルを取り込む` : '取り込めるファイルがありません'}
                        sub={
                          !d().files
                            ? 'ライブラリ内のファイルと空のフォルダは取り込めません'
                            : d().folders.length
                              ? 'ドロップ後にフォルダごとの取り込み方法を選択できます'
                              : flatSub()
                        }
                      />
                    )}
                  </Show>
                  <Show when={merging()}>
                    {(m) => (
                      <TagMergeDialog
                        from={m().from}
                        to={m().to}
                        count={lib().items.filter((i) => hasTag(i, m().from)).length}
                        covers={tagClash(lib(), m().from, m().to).covers}
                        onMerge={(keepFrom) => {
                          renameTag(m().from, m().to, keepFrom)
                          setMerging(undefined)
                        }}
                        onRename={(to) => requestRenameTag(m().from, to)}
                        onClose={() => setMerging(undefined)}
                      />
                    )}
                  </Show>
                  <Show when={goneTags()[0]}>
                    {(t) => (
                      <TagGoneDialog
                        tag={t()}
                        onDelete={() => {
                          deleteTagCover(t())
                          nextGoneTag()
                        }}
                        onClose={nextGoneTag}
                      />
                    )}
                  </Show>
                  <Show when={!orphansHeld() && orphans().length > 0}>
                    <OrphanDialog
                      orphans={orphans()}
                      onRelink={(meta, to) =>
                        settleOrphan(meta, backend.relinkMeta && (() => backend.relinkMeta!(meta, to)))
                      }
                      onDiscard={(meta) =>
                        settleOrphan(meta, backend.discardMeta && (() => backend.discardMeta!(meta)))
                      }
                      onClose={() => setOrphansHeld(true)}
                    />
                  </Show>
                  <Show when={deleting()} keyed>
                    {(ids) => {
                      const its = createMemo(() => ids.flatMap((id) => lib().byId.get(id) ?? []))
                      return (
                        <Show when={its().length}>
                          <DeleteDialog
                            items={its()}
                            onDelete={() => {
                              deleteItems(its().map((it) => it.id))
                              setDeleting(undefined)
                            }}
                            onClose={() => setDeleting(undefined)}
                          />
                        </Show>
                      )
                    }}
                  </Show>
                  <Show when={menuResult()} keyed>
                    {(r) => (
                      <MenuResultDialog
                        title={r.title}
                        rows={r.rows}
                        onCopy={(v) => void copy(v, 'コピーしました')}
                        onClose={() => setMenuResult(undefined)}
                      />
                    )}
                  </Show>
                  <Show when={menu()} keyed>
                    {(m) => {
                      const its = () => m.ids.flatMap((id) => lib().byId.get(id) ?? [])
                      const ids = () => its().map((it) => it.id)
                      const one = () => (its().length === 1 ? its()[0]?.id : undefined)
                      const { revealItem: reveal, openItemDefault: openDefault, itemPath } = backend
                      return (
                        <Show when={its().length}>
                          <ItemMenu
                            items={its()}
                            x={m.x}
                            y={m.y}
                            anchor={m.anchor}
                            onScreen={!!m.anchor}
                            pinned={ids().filter((id) => lib().pins.includes(id)).length}
                            lib={lib()}
                            tags={allTags()}
                            recentTags={recentTags()}
                            plugins={menuPlugins()}
                            revealLabel={REVEAL_LABEL}
                            onOpen={() => one() && openItem(one()!)}
                            onOpenInTab={() => one() && asNewTab(() => openItem(one()!))}
                            onOpenDefault={openDefault && (() => one() && void openDefault(one()!).catch(fail))}
                            onReveal={reveal && (() => one() && void reveal(one()!).catch(fail))}
                            onMove={(to) => moveItems(ids(), to)}
                            onTag={(tag, on) => tagItems(ids(), tag, on)}
                            onPin={(on) => pinItems(ids(), on)}
                            onCopyPath={
                              itemPath &&
                              (() =>
                                void Promise.all(ids().map(itemPath)).then(
                                  (ps) =>
                                    copy(
                                      ps.join('\n'),
                                      ps.length > 1 ? `${ps.length} 件のパスをコピーしました` : 'パスをコピーしました',
                                    ),
                                  (e: unknown) => notify(`コピーに失敗しました：${messageOf(e)}`, 'error'),
                                ))
                            }
                            onCopyName={() =>
                              void copy(
                                its()
                                  .map((it) => it.name)
                                  .join('\n'),
                                its().length > 1 ? `${its().length} 件の名前をコピーしました` : '名前をコピーしました',
                              )
                            }
                            onPlugin={(plugin, entry) => void runPlugin(ids(), plugin, entry)}
                            onDelete={backend.deleteItem && (() => setDeleting(ids()))}
                            onClose={() => menu() === m && setMenu(undefined)}
                          />
                        </Show>
                      )
                    }}
                  </Show>
                </ScreenFrame>
              </HoverHostProvider>
            </SelectionProvider>
          </ItemMenuProvider>
        </ThumbSeenProvider>
      </ThumbMakingProvider>
    </FormatsProvider>
  )
}
