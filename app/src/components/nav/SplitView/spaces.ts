import {
  type PaneDir,
  type SplitNode,
  insertBeside,
  insertOuter,
  leaves,
  removeLeaf,
  swapLeaves,
  withSizes,
} from './split'

/** 分割の木の葉 1 つ。タブをいくつか持ち、active のタブを出す。 */
export interface Pane {
  id: number
  tabs: number[]
  active: number
}

/** ワークスペース。ペインを tree の形にタイルして、1 つの窓に出す。 */
export interface Space {
  id: number
  tree: SplitNode
  panes: Pane[]
  /** 出している別のウィンドウ。なければ本体の窓。 */
  win?: number
}

export const isSplit = (s: Space) => !('pane' in s.tree)

/** ペインを、木の左上から右下への順に並べる。 */
export const panesOf = (s: Space) => leaves(s.tree).flatMap((id) => s.panes.find((p) => p.id === id) ?? [])

export const tabsOf = (s: Space) => panesOf(s).flatMap((p) => p.tabs)

export const paneWith = (s: Space, tab: number) => s.panes.find((p) => p.tabs.includes(tab))

export const soleSpace = (id: number, pane: number, tabs: number[]): Space => ({
  id,
  tree: { pane },
  panes: [{ id: pane, tabs, active: tabs[0] ?? -1 }],
})

const mapPane = (list: Space[], pane: number, f: (p: Pane) => Pane) =>
  list.map((s) =>
    s.panes.some((p) => p.id === pane) ? { ...s, panes: s.panes.map((p) => (p.id === pane ? f(p) : p)) } : s,
  )

/** tab を抜く。出していたタブなら、隣のタブを出す。空になったペインとワークスペースはなくす。 */
export function withoutTab(list: Space[], tab: number): Space[] {
  return list.flatMap((s) => {
    const p = paneWith(s, tab)
    if (!p) return [s]
    const i = p.tabs.indexOf(tab)
    const tabs = p.tabs.filter((t) => t !== tab)
    if (tabs.length) {
      const active = p.active === tab ? (tabs[i] ?? tabs[i - 1] ?? -1) : p.active
      return [{ ...s, panes: s.panes.map((x) => (x === p ? { ...p, tabs, active } : x)) }]
    }
    const tree = removeLeaf(s.tree, p.id)
    return tree ? [{ ...s, tree, panes: s.panes.filter((x) => x !== p) }] : []
  })
}

/** tab を pane に入れる。after のすぐ後ろに入れ、なければ末尾に足す。shown なら出す。 */
export const intoPane = (list: Space[], pane: number, tab: number, after?: number, shown = true): Space[] =>
  mapPane(withoutTab(list, tab), pane, (p) => {
    const at = after === undefined ? -1 : p.tabs.indexOf(after)
    return {
      ...p,
      tabs: at < 0 ? [...p.tabs, tab] : p.tabs.toSpliced(at + 1, 0, tab),
      active: shown ? tab : p.active,
    }
  })

/**
 * 分割していないワークスペースには、タブを 1 つだけ置く。ほかのタブは、make で 1 つずつワークスペースにして、すぐ後ろに並べる。
 * 分割していないワークスペースではペインのタブを出さないので、切り替えられないタブを残さないため
 */
export function spread(list: Space[], make: (tab: number, from: Space) => Space): Space[] {
  return list.flatMap((s) => {
    const p = s.panes[0]
    if (isSplit(s) || !p || p.tabs.length < 2) return [s]
    const [first = -1, ...rest] = p.tabs
    return [{ ...s, panes: [{ ...p, tabs: [first], active: first }] }, ...rest.map((t) => make(t, s))]
  })
}

/** tab を、同じペインの before の前に動かす。before がなければ末尾。 */
export const movedInPane = (list: Space[], tab: number, before?: number): Space[] =>
  list.map((s) => {
    const p = paneWith(s, tab)
    if (!p) return s
    const rest = p.tabs.filter((t) => t !== tab)
    const at = before === undefined ? -1 : rest.indexOf(before)
    const tabs = rest.toSpliced(at < 0 ? rest.length : at, 0, tab)
    return { ...s, panes: s.panes.map((x) => (x === p ? { ...p, tabs } : x)) }
  })

/** tab を、新しいペイン（id は pane）に入れて、target のペインの side の側に並べる。 */
export function besidePane(list: Space[], target: number, tab: number, side: PaneDir, pane: number): Space[] {
  const owner = list.find((s) => s.panes.some((p) => p.id === target))
  const from = owner?.panes.find((p) => p.id === target)
  // 1 つしかないタブを、そのペインの横に並べることはできない
  if (!owner || !from || (from.tabs.length === 1 && from.tabs[0] === tab)) return list
  return withPane(withoutTab(list, tab), owner.id, tab, pane, (tree) => insertBeside(tree, target, pane, side))
}

/** tab を、新しいペイン（id は pane）に入れて、target のペインのあるワークスペースの全体の side の側に並べる。 */
export function besideAll(list: Space[], target: number, tab: number, side: PaneDir, pane: number): Space[] {
  const owner = list.find((s) => s.panes.some((p) => p.id === target))
  const rest = withoutTab(list, tab)
  // tab を抜いてワークスペースごとなくなったら、並べる先がない
  if (!owner || !rest.some((s) => s.id === owner.id)) return list
  return withPane(rest, owner.id, tab, pane, (tree) => insertOuter(tree, pane, side))
}

const withPane = (list: Space[], space: number, tab: number, pane: number, place: (tree: SplitNode) => SplitNode) =>
  list.map((s) =>
    s.id === space ? { ...s, tree: place(s.tree), panes: [...s.panes, { id: pane, tabs: [tab], active: tab }] } : s,
  )

/** tab を、そのペインで出す。 */
export const activated = (list: Space[], tab: number): Space[] =>
  list.map((s) => {
    const p = paneWith(s, tab)
    return p && p.active !== tab ? { ...s, panes: s.panes.map((x) => (x === p ? { ...p, active: tab } : x)) } : s
  })

export const swappedIn = (list: Space[], a: number, b: number): Space[] =>
  list.map((s) => (s.panes.some((p) => p.id === a) ? { ...s, tree: swapLeaves(s.tree, a, b) } : s))

export const resizedIn = (list: Space[], id: number, path: number[], sizes: number[]): Space[] =>
  list.map((s) => (s.id === id ? { ...s, tree: withSizes(s.tree, path, sizes) } : s))
