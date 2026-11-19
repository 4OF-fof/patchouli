import type { Window as TauriWindow } from '@tauri-apps/api/window'
import { Show, batch, createEffect, createMemo, createSignal, untrack } from 'solid-js'
import type { SavedTabs } from '../backend'
import type { ToastLevel } from '../components/overlay/Toast/Toast'
import type { IconName } from '../components/base/Icon/Icon'
import { type DockAt, dockOn, within } from '../components/nav/SplitView/dock'
import { PaneHint, type PaneMove } from '../components/nav/SplitView/PaneMenu'
import { Seams } from '../components/nav/SplitView/Seams'
import {
  type PaneDir,
  type Rect,
  type SplitSide,
  leaves,
  neighborOf,
  parseSplit,
  rectsOf,
  savedSplit,
} from '../components/nav/SplitView/split'
import {
  type Pane,
  type Space,
  activated,
  besideAll,
  besidePane,
  intoPane,
  isSplit,
  movedInPane,
  paneWith,
  resizedIn,
  soleSpace,
  spread,
  tabsOf,
  withoutTab,
} from '../components/nav/SplitView/spaces'
import { asNewTab } from '../components/nav/TabPane/newTab'
import type { TabAction } from '../components/nav/TabMenu/TabMenu'
import type { TabEntry, TabStripProps } from '../components/nav/TabStrip/TabStrip'
import type { TabSlots } from '../components/nav/TabStrip/row'
import { prefs } from '../model/prefs'
import { nextPopout } from '../window/controls'
import { type Host, MAIN_HOST } from '../window/host'
import { viewportOf } from '../window/viewport'
import { type Tab, type View, recordOf } from './view'

const PANE_DIRS: PaneDir[] = ['left', 'right', 'up', 'down']
export const splitSpace = (s: Space | undefined) => (s && isSplit(s) ? s : undefined)
/** 本体の窓の番号。別のウィンドウは、これより大きい番号にする。 */
export const MAIN_WIN = 0
/** 別のウィンドウ。frame はデスクトップでの、その窓。 */
interface Popped {
  win: Window
  frame?: Promise<TauriWindow | null>
}
/** 右クリックしても、ペインを動かすメニューを出さないところ。 */
const NOT_EMPTY =
  'input, textarea, select, button, a, [role="button"], [role="menuitem"], [contenteditable="true"], img, video, audio, canvas, iframe'

export interface WorkspaceDeps {
  /** 新しいタブで最初に出す画面。 */
  startView: () => View
  labelOf: (v: View) => string
  iconOf: (v: View) => IconName
  notify: (message: string, level: ToastLevel) => void
  /** タブを閉じたとき。 */
  onTabGone: (id: number) => void
}

const sameView = (a: View | undefined, b: View) => JSON.stringify(a) === JSON.stringify(b)

/** タブ・ペイン・ワークスペースと、タブを出す別のウィンドウ。 */
export function createWorkspace(d: WorkspaceDeps) {
  const { startView, labelOf, iconOf, notify, onTabGone } = d
  let tabSeq = 0
  // タブは、ワークスペースのペインから id で引く
  const pool = new Map<number, Tab>()
  const makeTab = (views: View[] = [{ s: 'edition' }], from?: Tab): Tab => {
    const [stack, setStack] = createSignal(views)
    const t: Tab = { id: tabSeq++, stack, setStack: (s) => setStack(s), from }
    pool.set(t.id, t)
    return t
  }

  let spaceSeq = 0
  let paneSeq = 0
  const nextSpace = () => spaceSeq++
  const nextPane = () => paneSeq++
  /** t だけを置くワークスペース。win の窓に出す。 */
  const spaceFor = (t: Tab, win = MAIN_WIN): Space => {
    const s = soleSpace(nextSpace(), nextPane(), [t.id])
    return win === MAIN_WIN ? s : { ...s, win }
  }
  const startTab = makeTab([startView()])
  // ワークスペースの並び。窓ごとのタイトルバーには、その窓に出すものをこの順に並べる
  const [spaces, setRawSpaces] = createSignal<Space[]>([spaceFor(startTab)])
  const setSpaces = (list: Space[]) =>
    setRawSpaces(spread(list, (tab, from) => ({ ...soleSpace(nextSpace(), nextPane(), [tab]), win: from.win })))
  const tabs = createMemo(() => spaces().flatMap((s) => tabsOf(s).flatMap((id) => pool.get(id) ?? [])))
  const spaceByTab = createMemo(() => new Map(spaces().flatMap((s) => tabsOf(s).map((id) => [id, s] as const))))
  const spaceOf = (t: Tab) => spaceByTab().get(t.id)
  const paneOf = (t: Tab) => {
    const s = spaceOf(t)
    return s ? paneWith(s, t.id) : undefined
  }
  const spaceById = (id: number) => spaces().find((s) => s.id === id)
  // いま操作しているタブ。別のウィンドウにあるタブのこともある
  const [currentTab, setCurrentTab] = createSignal(startTab)
  // 操作するタブは、そのペインで出す
  createEffect(() => {
    const t = currentTab()
    untrack(() => {
      const p = paneOf(t)
      if (p && p.active !== t.id) setSpaces(activated(spaces(), t.id))
    })
  })
  // 別のウィンドウ。本体の窓と同じくタイトルバーにタブを並べ、ワークスペースの win でどの窓に出すかを決める。
  // 面は、窓の中身ができてから入る
  const [popped, setPopped] = createSignal<ReadonlyMap<number, Popped>>(new Map())
  const [popStages, setPopStages] = createSignal<ReadonlyMap<number, HTMLElement>>(new Map())
  const [mainStage, setMainStage] = createSignal<HTMLElement>()
  let winSeq = MAIN_WIN + 1
  /** ワークスペースを出している窓。閉じた窓のものは、本体の窓に出す。 */
  const winOf = (s: Space | undefined) => (s?.win !== undefined && popped().has(s.win) ? s.win : MAIN_WIN)
  const isAway = (s: Space | undefined) => winOf(s) !== MAIN_WIN
  const spacesIn = (k: number) => spaces().filter((s) => winOf(s) === k)
  // 窓ごとに出しているワークスペース。操作しているタブがほかの窓にあるあいだは、前のものを出しておく
  const [shownIds, setShownIds] = createSignal<ReadonlyMap<number, number>>(new Map())
  createEffect(() => {
    const s = spaceOf(currentTab())
    if (s) untrack(() => setShownIds((m) => new Map(m).set(winOf(s), s.id)))
  })
  const shownSpace = (k: number) => {
    const here = spacesIn(k)
    return here.find((s) => s.id === shownIds().get(k)) ?? here[0]
  }
  const mainSpace = createMemo(() => shownSpace(MAIN_WIN))
  // ワークスペースの名前と、選び直したときに操作するタブに、最後に操作したタブを使うため、操作した順を覚えておく
  const [seen, setSeen] = createSignal<ReadonlyMap<number, number>>(new Map())
  let seenSeq = 0
  createEffect(() => {
    const id = currentTab().id
    setSeen((m) => new Map(m).set(id, ++seenSeq))
  })
  const faceIn = (s: Space) => tabsOf(s).reduce((a, b) => ((seen().get(b) ?? 0) > (seen().get(a) ?? 0) ? b : a))
  const faceTab = (s: Space | undefined) => (s ? pool.get(faceIn(s)) : undefined)
  const rectsBySpace = createMemo(
    () =>
      new Map(
        spaces()
          .filter(isSplit)
          .map((s) => [s.id, rectsOf(s.tree)]),
      ),
  )
  const rectOfPane = (s: Space | undefined, pane: number | undefined) =>
    s && pane !== undefined ? rectsBySpace().get(s.id)?.get(pane) : undefined
  const stack = () => currentTab().stack()
  const setStack = (s: View[]) => currentTab().setStack(s)
  const eachStack = (f: (s: View[]) => View[]) => {
    for (const t of tabs()) t.setStack(f(t.stack()))
  }
  /** 本体の窓に出すワークスペースがなくなったら、新しいタブを 1 つ作る。 */
  const keepMain = () => {
    if (spaces().every(isAway)) setSpaces([...spaces(), spaceFor(makeTab())])
  }
  // 新しいタブは、分割したワークスペースなら操作しているペインの裏に、分割していないものならタイトルバーのすぐ後ろに開く。
  // 同じタブから続けて開いたものは、開いた順に並べる
  const openTab = (views: View[]) => {
    const cur = currentTab()
    const t = makeTab(views, cur)
    const s = spaceOf(cur)
    const p = paneOf(cur)
    if (!s || !p) {
      setSpaces([...spaces(), spaceFor(t)])
      return
    }
    if (!isSplit(s)) {
      const list = spaces()
      let at = list.indexOf(s) + 1
      while (list[at] && !isSplit(list[at]) && pool.get(tabsOf(list[at])[0] ?? -1)?.from === cur) at++
      setSpaces(list.toSpliced(at, 0, spaceFor(t, winOf(s))))
      return
    }
    let after = cur.id
    for (const id of p.tabs.slice(p.tabs.indexOf(cur.id) + 1)) {
      if (pool.get(id)?.from !== cur) break
      after = id
    }
    setSpaces(intoPane(spaces(), p.id, t.id, after, false))
  }
  /** k の窓のタイトルバーの末尾に、新しいタブを開く。 */
  const addSpace = (k: number) => {
    const t = makeTab()
    batch(() => {
      setSpaces([...spaces(), spaceFor(t, k)])
      setCurrentTab(t)
    })
  }
  const addInPane = (pane: number) => {
    const t = makeTab()
    const p = spaces()
      .flatMap((s) => s.panes)
      .find((x) => x.id === pane)
    batch(() => {
      setSpaces(intoPane(spaces(), pane, t.id, p?.active))
      setCurrentTab(t)
    })
  }
  const closeTab = (id: number) => {
    const t = pool.get(id)
    const s = t && spaceOf(t)
    if (!t || !s) return
    onTabGone(id)
    const pane = paneWith(s, id)?.id
    const k = winOf(s)
    const at = spacesIn(k).indexOf(s)
    let next = withoutTab(spaces(), id)
    const left = next.find((x) => x.id === s.id)
    const near = next.filter((x) => winOf(x) === k)
    const here = next.filter((x) => !isAway(x))
    if (!here.length) {
      const own = spaceFor(makeTab())
      next = [...next, own]
      here.push(own)
    }
    // 次に操作するのは、同じペインで次に出すタブ。ペインがなくなったら同じワークスペースのもの、
    // それもなければ同じ窓の近くのワークスペースのもの。窓が空になったら、本体の窓のもの
    const after =
      pool.get(left?.panes.find((p) => p.id === pane)?.active ?? -1) ??
      faceTab(left) ??
      faceTab(near[Math.min(at, near.length - 1)]) ??
      faceTab(here.find((x) => x.id === shownIds().get(MAIN_WIN)) ?? here[0])
    batch(() => {
      setSpaces(next)
      if (currentTab() === t && after) setCurrentTab(after)
      pool.delete(id)
    })
  }
  /** ワークスペースを before の前に動かす。 */
  const moveSpace = (id: number, before: number | undefined) => {
    const s = spaceById(id)
    if (!s) return
    const rest = spaces().filter((x) => x !== s)
    const at = before === undefined ? rest.length : rest.findIndex((x) => x.id === before)
    if (at >= 0) setSpaces(rest.toSpliced(at, 0, s))
  }
  /**
   * id のタブを、target のペインの side の側に新しいペインを作って並べる。side がなければ target のペインに入れる。
   * whole なら、target のペインのあるワークスペースの全体の side の側に並べる
   */
  const dock = (id: number, target: number, side?: PaneDir, whole = false) => {
    const t = pool.get(id)
    if (!t || (!side && paneOf(t)?.id === target)) return
    batch(() => {
      setSpaces(
        side
          ? (whole ? besideAll : besidePane)(spaces(), target, id, side, nextPane())
          : intoPane(spaces(), target, id),
      )
      setCurrentTab(t)
      keepMain()
    })
  }
  /** 落としても何も変わらないところ。もとのペインの中か、タブが 1 つだけのもとのペインの横。 */
  const useless = (id: number, at: DockAt) => {
    const t = pool.get(id)
    const p = t && paneOf(t)
    return !at.whole && p?.id === at.pane && (!at.side || p.tabs.length === 1)
  }
  /** 別のウィンドウを開く。大きさは本体の窓に合わせ、at があれば、その画面の上の位置に置く。 */
  const openPopup = (at?: { x: number; y: number }) => {
    const w = Math.round(innerWidth * 0.6)
    const h = Math.round(innerHeight * 0.7)
    const pos = at ? `,left=${Math.round(at.x - w / 2)},top=${Math.round(at.y - 12)}` : ''
    // 開く前から label を待つ。デスクトップでは、開いた順に届く
    const frame = nextPopout()
    const win = window.open('', '', `popup,width=${w},height=${h}${pos}`)
    if (!win) notify('別のウィンドウを開けませんでした', 'error')
    return win ? { win, frame } : undefined
  }
  /**
   * id のタブを、新しい別のウィンドウに出す。whole なら、そのタブのあるワークスペースごと出す。
   * すでに別のウィンドウにそれだけを出しているときは、何もしない
   */
  const openWindow = (id: number, at?: { x: number; y: number }, whole = false) => {
    const t = pool.get(id)
    const s = t && spaceOf(t)
    if (!t || (s && isAway(s) && spacesIn(winOf(s)).length === 1 && (whole || tabsOf(s).length === 1))) return
    const p = openPopup(at)
    if (!p) return
    const k = winSeq++
    batch(() => {
      setPopped((m) => new Map(m).set(k, p))
      if (whole && s) setSpaces([...spaces().filter((x) => x !== s), { ...s, win: k }])
      else setSpaces([...withoutTab(spaces(), id), spaceFor(t, k)])
      setCurrentTab(t)
      keepMain()
    })
  }
  /** 新しいタブを開いた別のウィンドウを開く。 */
  const openNewWindow = () => {
    const t = makeTab([startView()])
    openWindow(t.id)
  }
  // 窓を閉じたら、中のタブも閉じる。操作していたタブがそこにあったら、本体の窓に出しているものに移る
  const dropPopped = (k: number) => {
    const ids = new Set(spaces().flatMap((s) => (s.win === k ? tabsOf(s) : [])))
    let rest = spaces().filter((s) => s.win !== k)
    const here = rest.filter((s) => !isAway(s))
    if (ids.size && !here.length) {
      const own = spaceFor(makeTab())
      rest = [...rest, own]
      here.push(own)
    }
    const after = ids.has(currentTab().id)
      ? faceTab(here.find((s) => s.id === shownIds().get(MAIN_WIN)) ?? here[0])
      : undefined
    batch(() => {
      if (ids.size) setRawSpaces(rest)
      if (after) setCurrentTab(after)
      for (const id of ids) {
        onTabGone(id)
        pool.delete(id)
      }
      setPopped((m) => new Map([...m].filter(([x]) => x !== k)))
      setPopStages((m) => new Map([...m].filter(([x]) => x !== k)))
    })
  }
  // ワークスペースがすべてなくなった窓は閉じる
  createEffect(() => {
    const used = new Set(spaces().map(winOf))
    const gone = [...popped().keys()].filter((k) => !used.has(k))
    if (gone.length) untrack(() => gone.forEach(dropPopped))
  })
  const hostOfTab = (t: Tab): Host => {
    const k = winOf(spaceOf(t))
    const w = popStages().has(k) ? popped().get(k)?.win : undefined
    return w ? { win: w, doc: w.document, main: false } : MAIN_HOST
  }
  const stageOfTab = (t: Tab) => {
    const s = spaceOf(t)
    if (!s) return undefined
    return isAway(s) ? popStages().get(winOf(s)) : mainStage()
  }
  // ペインを動かすときやタブを落とすときに、行き先に重ねる印
  const [paneHint, setPaneHint] = createSignal<{ space: number; rect: Rect }>()
  const hintOfPane = (space: number, pane: number) => {
    const rect = rectOfPane(spaceById(space), pane)
    return rect && { space, rect }
  }
  /** 画面の上の位置にある窓。別のウィンドウが重なっていたら、そちらを先に見る。 */
  const winAt = (x: number, y: number): [number, Window] | undefined => {
    for (const [k, p] of popped()) if (within(p.win, x, y)) return [k, p.win]
    return within(window, x, y) ? [MAIN_WIN, window] : undefined
  }
  const stageIn = (k: number) => (k === MAIN_WIN ? mainStage() : popStages().get(k))
  /** 画面の上の位置に落としたときの先。 */
  const dockAt = (id: number, x: number, y: number) => {
    const w = winAt(x, y)
    const st = w && stageIn(w[0])
    const s = w && shownSpace(w[0])
    const at = w && st && s ? dockOn(w[1], st, s, x, y) : undefined
    return at && !useless(id, at) ? at : undefined
  }
  const outside = (x: number, y: number) => !winAt(x, y)
  // 窓ごとのタイトルバーのタブの列。ペインのタブを運んでくると、独立したタブとして入れる
  const [slotsOf, setSlotsOf] = createSignal<ReadonlyMap<number, TabSlots>>(new Map())
  const slotsIn = (k: number) => (s: TabSlots | undefined) =>
    setSlotsOf((m) => {
      const n = new Map(m)
      if (s) n.set(k, s)
      else n.delete(k)
      return n
    })
  /** 画面の上の位置が窓のタブの列の上なら、その窓と、そこで離したときに入る番号。 */
  const slotAt = (x: number, y: number) => {
    const w = winAt(x, y)
    const s = w && slotsOf().get(w[0])
    if (!w || !s) return undefined
    const v = viewportOf(w[1])
    const i = s.slotAt(x - v.x, y - v.y)
    return i === undefined ? undefined : { win: w[0], at: i, slots: s }
  }
  /**
   * id のタブを、同じワークスペースのほかのタブから分けて、k の窓のタイトルバーの at 番目に独立したタブとして入れる。
   * タブが 1 つだけのワークスペースと whole のときは、そのワークスペースごと動かす
   */
  const apart = (id: number, k: number, at: number, whole = false) => {
    const t = pool.get(id)
    const s = t && spaceOf(t)
    if (!t || !s) return
    const before = spacesIn(k)[at]
    const lone = whole || tabsOf(s).length === 1
    if (lone && before === s) return
    const rest = lone ? spaces().filter((x) => x !== s) : withoutTab(spaces(), id)
    const own = lone ? { ...s, win: k === MAIN_WIN ? undefined : k } : spaceFor(t, k)
    const last = rest.findLastIndex((x) => winOf(x) === k)
    const i = before ? rest.findIndex((x) => x.id === before.id) : last < 0 ? rest.length : last + 1
    batch(() => {
      setSpaces(rest.toSpliced(i < 0 ? rest.length : i, 0, own))
      setCurrentTab(t)
      keepMain()
    })
  }
  let marked: TabSlots | undefined
  /** id のタブを運んでいるあいだの、落とす先の印。ペインに落とせないときは undefined を渡す。 */
  const hintDrag = (id: number | undefined, x: number, y: number) => {
    const slot = slotAt(x, y)
    if (marked !== slot?.slots) marked?.mark(undefined)
    marked = slot?.slots
    marked?.mark(slot?.at)
    const at = id === undefined || slot ? undefined : dockAt(id, x, y)
    setPaneHint(at && { space: at.space, rect: at.hint })
  }
  const clearHint = () => {
    marked?.mark(undefined)
    marked = undefined
    setPaneHint(undefined)
  }
  const dragAway = (id: number | undefined, at: { x: number; y: number } | undefined) => {
    if (at) hintDrag(id, at.x, at.y)
    else clearHint()
  }
  /** タブの列から引き出した id のタブを、画面の上の位置で離したとき。ペインの横か中、タイトルバー、または窓の外へ動かす。 */
  const dropTab = (id: number, x: number, y: number) => {
    clearHint()
    const slot = slotAt(x, y)
    const at = slot ? undefined : dockAt(id, x, y)
    if (slot) apart(id, slot.win, slot.at)
    else if (at) dock(id, at.pane, at.side, at.whole)
    else if (outside(x, y)) openWindow(id, { x, y })
  }
  const [paneMenu, setPaneMenu] = createSignal<{
    tab: Tab
    space: number
    pane: number
    x: number
    y: number
    moves: PaneMove[]
  }>()
  /** 分割したペインの何もないところを右クリックしたら、動かせる向きを出す。入力欄や画像などの上では出さない。 */
  const openPaneMenu = (t: Tab, e: MouseEvent) => {
    const s = spaceOf(t)
    const p = paneOf(t)
    const rects = s && rectsBySpace().get(s.id)
    if (e.defaultPrevented || !s || !p || !rects?.has(p.id)) return
    if (e.target instanceof Element && e.target.closest(NOT_EMPTY)) return
    if (hostOfTab(t).win.getSelection()?.toString()) return
    const moves = PANE_DIRS.flatMap((dir) => {
      const to = neighborOf(rects, p.id, dir)
      return to === undefined ? [] : [{ dir, to }]
    })
    if (!moves.length) return
    e.preventDefault()
    setCurrentTab(t)
    setPaneMenu({ tab: t, space: s.id, pane: p.id, x: e.clientX, y: e.clientY, moves })
  }
  /** open で新しいタブに開いたものを、操作中のペインの横に並べる。 */
  const openBeside = (side: SplitSide, open: () => void) => {
    const before = new Set(tabs())
    const from = currentTab()
    asNewTab(open)
    const t = tabs().find((x) => !before.has(x))
    const p = paneOf(from)
    if (!t) return
    if (p) dock(t.id, p.id, side)
    else setCurrentTab(t)
  }
  const tabAction = (id: number, a: TabAction) => {
    const t = pool.get(id)
    const p = t && paneOf(t)
    if (a === 'window') openWindow(id)
    else if (p) dock(id, p.id, a)
  }
  /** 別のウィンドウにそれだけを出しているタブか。 */
  const aloneInWindow = (s: Space) => isAway(s) && tabsOf(s).length === 1 && spacesIn(winOf(s)).length === 1
  /** タブの右クリックで出す項目。ペインにほかのタブがあれば横に分けられる。 */
  const tabActions = (id: number): TabAction[] => {
    const t = pool.get(id)
    const s = t && spaceOf(t)
    if (!t || !s) return []
    if ((paneOf(t)?.tabs.length ?? 0) > 1) return ['right', 'down', 'window']
    return aloneInWindow(s) ? [] : ['window']
  }
  const tabEntry = (t: Tab): TabEntry => {
    const v = t.stack().at(-1) ?? { s: 'edition' }
    return { id: t.id, label: labelOf(v), icon: iconOf(v) }
  }
  /** k の窓で操作しているタブ。操作しているタブがほかの窓にあるときは、その窓に出しているワークスペースで最後に操作したもの。 */
  const tabIn = (k: number) => {
    const t = currentTab()
    const s = shownSpace(k)
    return spaceOf(t) === s ? t : faceTab(s)
  }
  /** タブが 1 つだけのワークスペースの、そのタブ。 */
  const loneTab = (id: number) => {
    const t = pool.get(id)
    const s = t && spaceOf(t)
    return s && tabsOf(s).length === 1 ? t : undefined
  }
  /**
   * k の窓のタイトルバーに並べる、ワークスペースごとのタブ。タブが 2 つ以上あるものは、最後に操作したタブの名前で 1 つにたたむ。
   * タブが 1 つだけのものはペインに落とせる。たたんだものは、ほかの窓のタイトルバーか窓の外へ、ワークスペースごと動かす
   */
  const tabStrip = (k: number): TabStripProps => ({
    tabs: spacesIn(k).flatMap((s) => {
      const f = faceTab(s)
      return f ? [{ ...tabEntry(f), count: tabsOf(s).length }] : []
    }),
    current: tabIn(k)?.id ?? -1,
    onSelect: (id) => {
      const t = pool.get(id)
      if (t) setCurrentTab(t)
    },
    onClose: (id) => {
      const t = pool.get(id)
      const s = t && spaceOf(t)
      if (s) for (const x of tabsOf(s)) closeTab(x)
    },
    onNew: () => addSpace(k),
    onAction: tabAction,
    actions: (e) => (loneTab(e.id) ? tabActions(e.id) : []),
    onMove: (id, before) => {
      const from = pool.get(id)
      const s = from && spaceOf(from)
      const b = before === undefined ? undefined : pool.get(before)
      if (s) moveSpace(s.id, b && spaceOf(b)?.id)
    },
    onDragAway: (id, at) => dragAway(loneTab(id)?.id, at),
    onDropAway: (id, x, y) => {
      if (loneTab(id)) {
        dropTab(id, x, y)
        return
      }
      clearHint()
      const slot = slotAt(x, y)
      if (slot) apart(id, slot.win, slot.at, true)
      else if (outside(x, y)) openWindow(id, { x, y }, true)
    },
    slots: slotsIn(k),
  })
  /** ペインの上端に出す、そのペインのタブ。 */
  const paneStrip = (p: Pane): TabStripProps => ({
    tabs: p.tabs.flatMap((id) => {
      const t = pool.get(id)
      return t ? [tabEntry(t)] : []
    }),
    current: p.active,
    onSelect: (id: number) => {
      const t = pool.get(id)
      if (t) setCurrentTab(t)
    },
    onClose: closeTab,
    onNew: () => addInPane(p.id),
    onAction: tabAction,
    actions: (e: TabEntry) => tabActions(e.id),
    onMove: (id, before) => setSpaces(movedInPane(spaces(), id, before)),
    onDragAway: dragAway,
    onDropAway: dropTab,
  })

  const firstTab = tabs()[0]
  const firstStack = firstTab?.stack()
  /** 保存したタブを戻す。readView は保存した 1 段を読み、開けないものは undefined を返す。 */
  const restoreTabs = (s: SavedTabs | undefined, readView: (v: unknown, from?: View) => View | undefined) => {
    const made = (Array.isArray(s?.tabs) ? s.tabs : [])
      .map((vs) =>
        (Array.isArray(vs) ? vs : []).reduce<View[]>((out, v) => {
          const read = readView(v, out.at(-1))
          return read ? [...out, read] : out
        }, []),
      )
      .map((vs) => (vs.length ? makeTab(vs) : undefined))
    const list = made.flatMap((t) => t ?? [])
    const at = typeof s?.current === 'number' ? s.current : 0
    const shown = made[at] ?? list[Math.min(Math.max(0, at), list.length - 1)]
    if (!shown) return
    const used = new Set<number>()
    const readSpace = (v: unknown): Space[] => {
      const x = recordOf(v)
      const panes = (Array.isArray(x.panes) ? x.panes : []).map((p): Pane => {
        const y = recordOf(p)
        const ids = (Array.isArray(y.tabs) ? y.tabs : []).flatMap((i) => {
          const t = typeof i === 'number' ? made[i] : undefined
          if (!t || used.has(t.id)) return []
          used.add(t.id)
          return [t.id]
        })
        const active = typeof y.active === 'number' ? made[y.active]?.id : undefined
        return {
          id: nextPane(),
          tabs: ids,
          active: active !== undefined && ids.includes(active) ? active : (ids[0] ?? -1),
        }
      })
      const tree = parseSplit(x.tree, (i) => (panes[i]?.tabs.length ? panes[i].id : undefined))
      const kept = tree ? leaves(tree) : []
      const ok = !!tree && new Set(kept).size === kept.length
      // 木に入らなかったペインのタブは、1 つずつのワークスペースにする
      for (const p of panes) if (!ok || !kept.includes(p.id)) for (const id of p.tabs) used.delete(id)
      return ok ? [{ id: nextSpace(), tree, panes: panes.filter((p) => kept.includes(p.id)) }] : []
    }
    const read = [
      ...(Array.isArray(s?.spaces) ? s.spaces : []).flatMap(readSpace),
      ...list.filter((t) => !used.has(t.id)).map(spaceFor),
    ]
    // 読み終える前にタブを操作していたら、そのタブは後ろに残して、表に出したままにする
    const touched = tabs().length > 1 || currentTab() !== firstTab || firstTab?.stack() !== firstStack
    batch(() => {
      if (touched) {
        setSpaces([...read, ...spaces()])
        return
      }
      const old = tabs()
      setSpaces(read)
      setCurrentTab(shown)
      for (const t of old) pool.delete(t.id)
      const home = startView()
      if (prefs().start !== 'last' && !sameView(shown.stack().at(-1), home)) shown.setStack([...shown.stack(), home])
    })
  }

  /** 書き出すタブ。savedView は画面の 1 段を書き出せる形にする。 */
  const savedTabs = (savedView: (v: View) => unknown): SavedTabs => {
    const list = tabs()
    const index = (id: number) => list.findIndex((t) => t.id === id)
    return {
      tabs: list.map((t) => t.stack().map(savedView)),
      current: list.indexOf(currentTab()),
      spaces: spaces().map((x) => ({
        tree: savedSplit(x.tree, (id) => x.panes.findIndex((p) => p.id === id)),
        panes: x.panes.map((p) => ({ tabs: p.tabs.map(index), active: index(p.active) })),
      })),
    }
  }

  const hintIn = (s: Space | undefined) => {
    const h = paneHint()
    return s && h?.space === s.id ? h.rect : undefined
  }
  /** 窓の面に、タブの画面と一緒に重ねるもの。 */
  const paneLayers = (s: () => Space | undefined) => (
    <>
      <Show when={hintIn(s())}>{(r) => <PaneHint rect={r()} />}</Show>
      <Show when={splitSpace(s())}>
        {(sp) => (
          <Seams node={sp().tree} onSizes={(path, sizes) => setSpaces(resizedIn(spaces(), sp().id, path, sizes))} />
        )}
      </Show>
    </>
  )
  return {
    tabs,
    currentTab,
    setCurrentTab,
    spaces,
    setSpaces,
    spaceOf,
    paneOf,
    winOf,
    shownSpace,
    mainSpace,
    rectOfPane,
    stack,
    setStack,
    eachStack,
    openTab,
    openNewWindow,
    dropPopped,
    hostOfTab,
    stageOfTab,
    setPaneHint,
    hintOfPane,
    dragAway,
    dropTab,
    paneMenu,
    setPaneMenu,
    openPaneMenu,
    openBeside,
    tabEntry,
    tabIn,
    tabStrip,
    paneStrip,
    popped,
    popStages,
    setPopStages,
    setMainStage,
    restoreTabs,
    savedTabs,
    paneLayers,
  }
}
