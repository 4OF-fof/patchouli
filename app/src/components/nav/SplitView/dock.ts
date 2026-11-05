import { type Space, isSplit, panesOf } from './spaces'
import { viewportOf } from '../../../window/viewport'
import { type PaneDir, type Rect, rectsOf } from './split'

/** ペインの端からこの割合までに落とすと、その側に並べる。内側なら、そのペインのタブに加える。 */
const EDGE = 0.25
/** 分割した面の縁からこれだけ（px）までに落とすと、ワークスペースの全体の側に並べる。 */
const RIM = 24

/** タブを落とす先。side がなければ、そのペインのタブに加える。hint は落とす前に出す印の場所。 */
export interface DockAt {
  space: number
  pane: number
  side?: PaneDir
  /** side を、ペインではなくワークスペースの全体の側にする。 */
  whole?: boolean
  hint: Rect
}

const nearest = (near: [PaneDir, number][]) => near.reduce((a, b) => (b[1] < a[1] ? b : a))

const zoneOf = (r: Rect, x: number, y: number): PaneDir | undefined => {
  const dx = (x - r.x) / r.w
  const dy = (y - r.y) / r.h
  const near: [PaneDir, number][] = [
    ['left', dx],
    ['right', 1 - dx],
    ['up', dy],
    ['down', 1 - dy],
  ]
  const [side, d] = nearest(near)
  return d < EDGE ? side : undefined
}

/** 面の縁の帯の上なら、その側。rim は帯の幅で、全体を 1 とした割合。 */
const rimOf = (x: number, y: number, rim: { x: number; y: number }): PaneDir | undefined => {
  const [side, d] = nearest([
    ['left', x / rim.x],
    ['right', (1 - x) / rim.x],
    ['up', y / rim.y],
    ['down', (1 - y) / rim.y],
  ])
  return d < 1 ? side : undefined
}

const hintOf = (r: Rect, side?: PaneDir): Rect =>
  side === 'left'
    ? { ...r, w: r.w / 2 }
    : side === 'right'
      ? { ...r, x: r.x + r.w / 2, w: r.w / 2 }
      : side === 'up'
        ? { ...r, h: r.h / 2 }
        : side === 'down'
          ? { ...r, y: r.y + r.h / 2, h: r.h / 2 }
          : r

/** ワークスペースの面の上の位置（全体を 1 とした割合）に落とすときの先。rim は縁の帯の幅で、全体を 1 とした割合。 */
function dockIn(s: Space, x: number, y: number, rim?: { x: number; y: number }): DockAt | undefined {
  const rects = rectsOf(s.tree)
  const outer = rim && isSplit(s) ? rimOf(x, y, rim) : undefined
  for (const p of panesOf(s)) {
    const r = rects.get(p.id)
    if (!r || x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue
    if (outer)
      return { space: s.id, pane: p.id, side: outer, whole: true, hint: hintOf({ x: 0, y: 0, w: 1, h: 1 }, outer) }
    const side = zoneOf(r, x, y)
    return { space: s.id, pane: p.id, side, hint: hintOf(r, side) }
  }
  return undefined
}

/** 画面の上の位置が、窓の中身の上にあるか。 */
export function within(w: Window, x: number, y: number) {
  const v = viewportOf(w)
  return x >= v.x && y >= v.y && x <= v.x + v.w && y <= v.y + v.h
}

/** 窓 w の面 stage に出しているワークスペースの、画面の上の位置に落とすときの先。 */
export function dockOn(w: Window, stage: HTMLElement, s: Space, x: number, y: number) {
  const v = viewportOf(w)
  const r = stage.getBoundingClientRect()
  return dockIn(s, (x - v.x - r.left) / r.width, (y - v.y - r.top) / r.height, { x: RIM / r.width, y: RIM / r.height })
}
