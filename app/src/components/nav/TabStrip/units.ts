import { createMemo, createSignal } from 'solid-js'
import type { TabAction } from '../TabMenu/TabMenu'
import type { TabEntry, TabStripProps } from './TabStrip'

/** タブの列の 1 つ分。分割して並べるタブのまとまりは、まとめて 1 つにする。 */
export interface TabUnit {
  tabs: TabEntry[]
  group: boolean
}

export function unitsOf(tabs: TabEntry[]): TabUnit[] {
  const out: TabUnit[] = []
  for (const t of tabs) {
    const last = out.at(-1)
    if (t.group !== undefined && last?.group && last.tabs[0]?.group === t.group) last.tabs.push(t)
    else out.push({ tabs: [t], group: t.group !== undefined })
  }
  return out
}

/** たたんだまとまりの表に出すタブ。 */
export const faceOf = (u: TabUnit) => u.tabs.find((t) => t.face) ?? u.tabs[0]

/** 押してから、並び替えのドラッグとみなすまでに動かす距離（px）。 */
const SLOP = 4

const swallow = (c: MouseEvent) => {
  c.stopPropagation()
  c.preventDefault()
}

export interface Drag {
  /** つかんだまとまりの番号。 */
  from: number
  /** 離したら入る番号。 */
  to: number
  /** つかんだまとまりを、押したところから動かした量（px）。 */
  by: number
  /** つかんだまとまりの大きさと、隣との間。ほかのまとまりは、この分だけよける。 */
  size: number
}

/**
 * タブの列の中で、押したまとまりを動かす。つかんだものはカーソルに付いて動き、ほかは入る場所を空けるようによける。
 * 動かさずに離したときは、ふつうの押下のままにする。
 */
export function dragUnit(
  e: PointerEvent,
  from: number,
  list: HTMLElement,
  axis: 'x' | 'y',
  onDrag: (d: Drag | undefined) => void,
  onDrop: (d: Drag) => void,
) {
  if (e.button !== 0) return
  const pos = (p: PointerEvent) => (axis === 'x' ? p.clientX : p.clientY)
  const start = pos(e)
  const rects = [...list.querySelectorAll(':scope > [data-unit]')].map((u) => u.getBoundingClientRect())
  const lo = (r: DOMRect) => (axis === 'x' ? r.left : r.top)
  const hi = (r: DOMRect) => (axis === 'x' ? r.right : r.bottom)
  const self = rects[from]
  const [a, b] = rects
  if (!self) return
  const size = hi(self) - lo(self) + (a && b ? lo(b) - hi(a) : 0)
  let d: Drag | undefined
  const at = (p: PointerEvent) => {
    const now = pos(p)
    const to = rects.filter((r, i) => i !== from && now > (lo(r) + hi(r)) / 2).length
    return { from, to, by: now - start, size }
  }
  const move = (m: PointerEvent) => {
    if (!d && Math.abs(pos(m) - start) < SLOP) return
    d = at(m)
    onDrag(d)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
  }
  const cancel = () => {
    stop()
    if (d) onDrag(undefined)
  }
  const up = (u: PointerEvent) => {
    stop()
    if (!d) return
    onDrag(undefined)
    onDrop(at(u))
    // 離したときに起きる click で、タブを選んだことにしない
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}

/** ドラッグ中に、i 番目のまとまりをずらす量（px）。 */
export function shiftOf(d: Drag, i: number) {
  if (i === d.from) return d.by
  if (i < d.from && i >= d.to) return d.size
  if (i > d.from && i <= d.to) return -d.size
  return 0
}

/** 右クリックで出す項目。見えているタブは分割せず、グループのタブはふつうのタブに戻すだけにする。 */
export function actionsOf(t: TabEntry, current: number): TabAction[] {
  if (t.group !== undefined) return t.shown ? ['detach'] : []
  return t.id === current ? [] : ['right', 'down']
}

export type TabMenuAt = { id: number; x: number; y: number; actions: TabAction[] }

/** タブの列の、まとまりの並び・右クリック・ドラッグの受け持ち。上と左のタブの列で使う。 */
export function createTabUnits(props: TabStripProps, axis: 'x' | 'y', list: () => HTMLElement) {
  const [menu, setMenu] = createSignal<TabMenuAt>()
  const [drag, setDrag] = createSignal<Drag>()
  const units = createMemo(() => unitsOf(props.tabs))
  const openMenu = (t: TabEntry, e: MouseEvent) => {
    const actions = props.onAction ? actionsOf(t, props.current) : []
    if (!actions.length) return
    e.preventDefault()
    setMenu({ id: t.id, x: e.clientX, y: e.clientY, actions })
  }
  const startDrag = (i: number, e: PointerEvent) => {
    const id = units()[i]?.tabs[0]?.id
    if (id === undefined || !props.onMove) return
    dragUnit(e, i, list(), axis, setDrag, (d) => {
      if (d.to === d.from) return
      const others = units().filter((_, j) => j !== d.from)
      props.onMove?.(id, others[d.to]?.tabs[0]?.id)
    })
  }
  /** i 番目のまとまりに付ける transform。ドラッグしていないときは付けない。 */
  const shift = (i: number) => {
    const d = drag()
    if (!d) return undefined
    const by = shiftOf(d, i)
    return by ? `translate${axis === 'x' ? 'X' : 'Y'}(${by}px)` : undefined
  }
  const dragging = () => drag()?.from
  const closeAll = (u: TabUnit) => {
    for (const t of u.tabs) props.onClose(t.id)
  }
  return { units, menu, setMenu, openMenu, startDrag, shift, dragging, closeAll }
}

export type TabUnits = ReturnType<typeof createTabUnits>
