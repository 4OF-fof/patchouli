import { createSignal, onCleanup, onMount } from 'solid-js'
import type { TabAction } from '../TabMenu/TabMenu'
import { ghostOf } from './ghost'
import type { TabEntry, TabStripProps } from './TabStrip'

/** 押してから、並び替えのドラッグとみなすまでに動かす距離（px）。 */
const SLOP = 4
/** 列の横（縦の列なら上下）にこれだけ離れたら、列の外へ運んでいるとみなす（px）。 */
const AWAY = 16

const swallow = (c: MouseEvent) => {
  c.stopPropagation()
  c.preventDefault()
}

export interface Drag {
  /** つかんだタブの番号。 */
  from: number
  /** 離したら入る番号。 */
  to: number
  /** つかんだタブを、押したところから動かした量（px）。 */
  by: number
  /** つかんだタブの大きさと、隣との間。ほかのタブは、この分だけよける。 */
  size: number
  /** 列の外へ引き出している。 */
  lifted?: boolean
}

export interface DragHandlers {
  onDrag: (d: Drag | undefined) => void
  onDrop: (d: Drag) => void
  /** 列の外へ運んでいるあいだの位置（画面の上の位置）。列に戻ったら undefined */
  onAway?: (at: { x: number; y: number } | undefined) => void
  /** 列の外か窓の外で離したとき。位置は画面の上の位置 */
  onDropAway?: (x: number, y: number) => void
}

const rectsOf = (list: HTMLElement) =>
  [...list.querySelectorAll(':scope > [data-tab]')].map((el) => el.getBoundingClientRect())

/** 列と直角の向きに、列から離れているか。 */
const offList = (list: HTMLElement, axis: 'x' | 'y', x: number, y: number) => {
  const r = list.getBoundingClientRect()
  return axis === 'x' ? y < r.top - AWAY || y > r.bottom + AWAY : x < r.left - AWAY || x > r.right + AWAY
}

/** ほかのタブの列の上にあるか。列どうしが近いと、離れたとみなす幅が隣の列にかかるため。 */
const overOther = (list: HTMLElement, x: number, y: number) => {
  const at = list.ownerDocument.elementFromPoint(x, y)?.closest('[role="tablist"]')
  return !!at && at !== list
}

const offWindow = (w: Window, p: PointerEvent) =>
  p.clientX < 0 || p.clientY < 0 || p.clientX > w.innerWidth || p.clientY > w.innerHeight

/**
 * タブの列の中で、押したタブを動かす。列の中では並びの向きにだけ動かし、ほかは入る場所を空けるようによける。
 * 列の外へ引き出したら、写しをカーソルに付けて動かし、onAway に位置を渡す。そこで離したら onDropAway を呼ぶ。
 * 動かさずに離したときは、ふつうの押下のままにする。
 */
export function dragTab(e: PointerEvent, from: number, list: HTMLElement, axis: 'x' | 'y', h: DragHandlers) {
  const el = e.currentTarget
  const win = list.ownerDocument.defaultView
  if (e.button !== 0 || !(el instanceof HTMLElement) || !win) return
  const pos = (p: PointerEvent) => (axis === 'x' ? p.clientX : p.clientY)
  const start = pos(e)
  const rects = rectsOf(list)
  const lo = (r: DOMRect) => (axis === 'x' ? r.left : r.top)
  const hi = (r: DOMRect) => (axis === 'x' ? r.right : r.bottom)
  const self = rects[from]
  const [a, b] = rects
  if (!self) return
  const size = hi(self) - lo(self) + (a && b ? lo(b) - hi(a) : 0)
  let d: Drag | undefined
  let ghost: ReturnType<typeof ghostOf> | undefined
  const at = (p: PointerEvent) => {
    const now = pos(p)
    const to = rects.filter((r, i) => i !== from && now > (lo(r) + hi(r)) / 2).length
    return { from, to, by: now - start, size }
  }
  let lifted = false
  const land = () => {
    ghost?.remove()
    ghost = undefined
    lifted = false
    h.onAway?.(undefined)
  }
  const move = (m: PointerEvent) => {
    if (!d && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < SLOP) return
    // 押したときに捕まえると、離したときの click が中のボタンに届かなくなるので、動かしてから捕まえる
    if (!d) el.setPointerCapture(e.pointerId)
    d = at(m)
    if (
      h.onAway &&
      (offWindow(win, m) || offList(list, axis, m.clientX, m.clientY) || overOther(list, m.clientX, m.clientY))
    ) {
      if (!lifted) ghost = ghostOf(el, self, e.clientX, e.clientY)
      lifted = true
      ghost?.move({ x: m.clientX, y: m.clientY }, { x: m.screenX, y: m.screenY }, offWindow(win, m))
      h.onDrag({ from, to: from, by: 0, size, lifted: true })
      h.onAway({ x: m.screenX, y: m.screenY })
      return
    }
    if (lifted) land()
    h.onDrag(d)
  }
  const stop = () => {
    win.removeEventListener('pointermove', move)
    win.removeEventListener('pointerup', up)
    win.removeEventListener('pointercancel', cancel)
  }
  const cancel = () => {
    stop()
    if (lifted) land()
    if (d) h.onDrag(undefined)
  }
  const up = (u: PointerEvent) => {
    stop()
    if (!d) return
    const away = lifted || offWindow(win, u)
    if (lifted) land()
    h.onDrag(undefined)
    if (away) h.onDropAway?.(u.screenX, u.screenY)
    else h.onDrop(at(u))
    // 離したときに起きる click で、タブを選んだことにしない
    win.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => win.removeEventListener('click', swallow, { capture: true }))
  }
  win.addEventListener('pointermove', move)
  win.addEventListener('pointerup', up)
  win.addEventListener('pointercancel', cancel)
}

/** タブの列の外からつかんだときの写しの大きさ（px）と、つかんだところの写しの中の位置。 */
const LIFT = { w: 150, h: 26, x: 20 }

/**
 * タブの列の外にあるもの（パンくずの段など）を押して、タブを運ぶ。列の中の並び替えはなく、動かしたらすぐ写しをカーソルに付ける。
 * ghost は写しの元で、押したものの窓の文書に移してから写す。動かさずに離したときは、ふつうの押下のままにする。
 */
export function liftWith(
  e: PointerEvent,
  ghost: () => HTMLElement | undefined,
  h: Required<Pick<DragHandlers, 'onAway' | 'onDropAway'>>,
) {
  const el = e.currentTarget
  const win = el instanceof HTMLElement ? el.ownerDocument.defaultView : undefined
  if (e.button !== 0 || !(el instanceof HTMLElement) || !win) return
  let g: ReturnType<typeof ghostOf> | undefined
  let moved = false
  const move = (m: PointerEvent) => {
    if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < SLOP) return
    if (!moved) {
      moved = true
      el.setPointerCapture(e.pointerId)
      const src = ghost()
      const r = new DOMRect(e.clientX - LIFT.x, e.clientY - LIFT.h / 2, LIFT.w, LIFT.h)
      g = src && ghostOf(el.ownerDocument.adoptNode(src), r, e.clientX, e.clientY)
    }
    g?.move({ x: m.clientX, y: m.clientY }, { x: m.screenX, y: m.screenY }, offWindow(win, m))
    h.onAway({ x: m.screenX, y: m.screenY })
  }
  const stop = () => {
    win.removeEventListener('pointermove', move)
    win.removeEventListener('pointerup', up)
    win.removeEventListener('pointercancel', cancel)
  }
  const land = () => {
    g?.remove()
    h.onAway(undefined)
  }
  const cancel = () => {
    stop()
    if (moved) land()
  }
  const up = (u: PointerEvent) => {
    stop()
    if (!moved) return
    land()
    h.onDropAway(u.screenX, u.screenY)
    win.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => win.removeEventListener('click', swallow, { capture: true }))
  }
  win.addEventListener('pointermove', move)
  win.addEventListener('pointerup', up)
  win.addEventListener('pointercancel', cancel)
}

/** ドラッグ中に、i 番目のタブをずらす量（px）。 */
export function shiftOf(d: Drag, i: number) {
  if (i === d.from) return d.by
  if (i < d.from && i >= d.to) return d.size
  if (i > d.from && i <= d.to) return -d.size
  return 0
}

export type TabMenuAt = { id: number; x: number; y: number; actions: TabAction[] }

/** ほかの列から運んできたタブを受ける、タブの列。 */
export interface TabSlots {
  /** 窓の中の位置で離したら入る番号。列の上でなければ undefined */
  slotAt: (x: number, y: number) => number | undefined
  /** 入る番号に印を出す。undefined で消す */
  mark: (i: number | undefined) => void
}

/** タブの列の、右クリック・ドラッグでの並べ替え・運んできたタブの受け入れの受け持ち。上と左のタブの列で使う。 */
export function createTabRow(props: TabStripProps, axis: 'x' | 'y', list: () => HTMLElement) {
  const [menu, setMenu] = createSignal<TabMenuAt>()
  const [drag, setDrag] = createSignal<Drag>()
  const [incoming, setIncoming] = createSignal<number>()
  const openMenu = (t: TabEntry, e: MouseEvent) => {
    const actions = (props.onAction && props.actions?.(t)) || []
    if (!actions.length) return
    e.preventDefault()
    setMenu({ id: t.id, x: e.clientX, y: e.clientY, actions })
  }
  const startDrag = (i: number, e: PointerEvent) => {
    const id = props.tabs[i]?.id
    if (id === undefined || !props.onMove) return
    dragTab(e, i, list(), axis, {
      onDrag: setDrag,
      onDrop: (d) => {
        if (d.to === d.from) return
        const others = props.tabs.filter((_, j) => j !== d.from)
        props.onMove?.(id, others[d.to]?.id)
      },
      onAway: props.onDragAway && ((at) => props.onDragAway?.(id, at)),
      onDropAway: props.onDropAway && ((x, y) => props.onDropAway?.(id, x, y)),
    })
  }
  /** i 番目のタブに付ける transform。ドラッグしていないときは付けない。 */
  const shift = (i: number) => {
    const d = drag()
    if (!d) return undefined
    const by = shiftOf(d, i)
    return by ? `translate${axis === 'x' ? 'X' : 'Y'}(${by}px)` : undefined
  }
  const dragging = () => drag()?.from
  const lifted = () => (drag()?.lifted ? drag()?.from : undefined)
  /** i 番目のタブの前（last なら後ろ）に、運んできたタブが入る印を出すか。 */
  const dropAt = (i: number) => {
    const n = incoming()
    if (n === i) return 'before'
    return n === props.tabs.length && i === props.tabs.length - 1 ? 'after' : undefined
  }
  const slots: TabSlots = {
    slotAt: (x, y) => {
      const l = list()
      if (!l || offList(l, axis, x, y)) return undefined
      const r = l.getBoundingClientRect()
      if (axis === 'x' ? x < r.left || x > r.right + AWAY * 4 : y < r.top || y > r.bottom + AWAY * 4) return undefined
      const p = axis === 'x' ? x : y
      return rectsOf(l).filter((t) => p > (axis === 'x' ? (t.left + t.right) / 2 : (t.top + t.bottom) / 2)).length
    },
    mark: setIncoming,
  }
  const receiving = () => incoming() !== undefined
  return { menu, setMenu, openMenu, startDrag, shift, dragging, lifted, dropAt, receiving, slots }
}

export type TabRow = ReturnType<typeof createTabRow>

/** 置いているあいだ、運んできたタブの受け口を渡しておく。 */
export function useSlots(props: TabStripProps, row: TabRow) {
  onMount(() => props.slots?.(row.slots))
  onCleanup(() => props.slots?.(undefined))
}
