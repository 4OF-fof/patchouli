import { type JSX, Show, createContext, createEffect, createSignal, on, onCleanup, onMount, useContext } from 'solid-js'
import { NavMenu, type NavMenuEntry } from '../NavMenu/NavMenu'
import styles from './CascadeMenu.module.css'
import { GRACE, OPEN_DELAY, type Point, type Side, graceArea, inside } from './grace'

export interface CascadeMenuProps {
  /** sub を付けた項目は、選ぶか乗せると submenu を横に出す */
  items: NavMenuEntry[]
  submenu: (id: string) => JSX.Element
  onSelect?: (id: string) => void
  /** sub の項目を押したときも onSelect を呼ぶ。開くのは、乗せたときと → のときだけになる */
  selectSub?: boolean
  onClose?: () => void
  focusFirst?: boolean
}

type Across = Exclude<Side, 'down'>

type Hold = (p: Point) => boolean

/** 奥の段は、手前の段に、向かっている途中かを答える関数を渡す */
const ParentContext = createContext<{ side: () => Across; attach: (hold: Hold) => () => void }>()

const MARGIN = 8
const GAP = 2
// サブメニューの最初の項目を、開いた項目の高さにそろえる（枠線と余白の分）
const INSET = 7

/** サブメニューを横に重ねていくメニュー。サブメニューの中にも置ける。 */
export function CascadeMenu(props: CascadeMenuProps) {
  const parent = useContext(ParentContext)
  const want = parent?.side
  const [open, setOpen] = createSignal<{ id: string; top: number }>()
  const [pos, setPos] = createSignal({ left: 0, top: 0 })
  const [side, setSide] = createSignal<Across>(want?.() ?? 'right')
  let box!: HTMLDivElement
  let sub: HTMLDivElement | undefined
  let row: HTMLElement | undefined
  let timer: number | undefined
  let pending: string | undefined
  let grace: Point[] | undefined
  let graceTimer: number | undefined
  let last: Point | undefined
  let lastTarget: Node | undefined
  let onRow = false
  let hovered: { id: string; el: HTMLElement } | undefined
  let child: Hold | undefined
  const attach = (hold: Hold) => {
    child = hold
    return () => {
      if (child === hold) child = undefined
    }
  }
  const hasSub = (id: string) => props.items.some((it) => it !== 'separator' && it.id === id && it.sub)
  const focusSub = () => queueMicrotask(() => sub?.querySelector<HTMLElement>('input, [role="menuitem"]')?.focus())
  const endGrace = () => {
    clearTimeout(graceTimer)
    grace = undefined
  }
  const show = (id?: string, el?: HTMLElement, focus = false) => {
    clearTimeout(timer)
    pending = undefined
    if (!id || !el) {
      endGrace()
      row = undefined
      setOpen(undefined)
      return
    }
    if (open()?.id !== id) {
      endGrace()
      row = el
      setOpen({ id, top: el.getBoundingClientRect().top - box.getBoundingClientRect().top })
    }
    if (focus) focusSub()
  }
  const place = () => {
    const o = open()
    if (!sub || !o) return
    const base = box.getBoundingClientRect()
    const s = sub.getBoundingClientRect()
    const toRight = base.right + GAP
    const toLeft = base.left - GAP - s.width
    const fitsRight = toRight + s.width + MARGIN <= innerWidth
    const next: Across = fitsRight && ((want?.() ?? 'right') === 'right' || toLeft < MARGIN) ? 'right' : 'left'
    const left = next === 'right' ? toRight : Math.max(MARGIN, toLeft)
    const top = Math.max(MARGIN, Math.min(base.top + o.top - INSET, innerHeight - s.height - MARGIN))
    setSide(next)
    setPos({ left: left - base.left, top: top - base.top })
  }
  createEffect(on(open, place))
  createEffect(() => {
    if (!open()) return
    const ro = new ResizeObserver(place)
    if (sub) ro.observe(sub)
    onCleanup(() => ro.disconnect())
  })
  const startGrace = (p: Point) => {
    if (!sub) return
    grace = graceArea(p, sub.getBoundingClientRect(), side())
    clearTimeout(graceTimer)
    graceTimer = window.setTimeout(() => {
      grace = undefined
      decide()
    }, GRACE)
  }
  const holds: Hold = (p) => !!open() && ((!!grace && inside(p, grace)) || !!child?.(p))
  const enter = (id: string, el: HTMLElement) => {
    if (open()?.id === id || pending === id) return
    if (!hasSub(id)) {
      show()
      return
    }
    clearTimeout(timer)
    pending = id
    timer = window.setTimeout(() => {
      pending = undefined
      if (lastTarget && el.contains(lastTarget)) show(id, el)
    }, OPEN_DELAY)
  }
  const decide = () => {
    const t = lastTarget
    const p = last
    if (!t || !p) return
    if (open() && !row?.contains(t) && !sub?.contains(t) && !holds(p)) show()
    if (hovered?.el.contains(t) && !holds(p)) enter(hovered.id, hovered.el)
  }
  const onMove = (e: PointerEvent) => {
    if (!(e.target instanceof Node)) return
    last = { x: e.clientX, y: e.clientY }
    lastTarget = e.target
    const was = onRow
    onRow = !!row?.contains(e.target)
    if (sub?.contains(e.target)) endGrace()
    else if (open() && was && !onRow) startGrace(last)
    decide()
  }
  onMount(() => {
    document.addEventListener('pointermove', onMove)
    const detach = parent?.attach(holds)
    if (detach) onCleanup(detach)
  })
  onCleanup(() => {
    clearTimeout(timer)
    clearTimeout(graceTimer)
    document.removeEventListener('pointermove', onMove)
  })
  const onSelect = (id: string, el: HTMLElement) =>
    hasSub(id) && !props.selectSub ? show(id, el, true) : props.onSelect?.(id)
  const onHover = (id: string, el: HTMLElement) => {
    hovered = { id, el }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' || !open() || e.target instanceof HTMLInputElement) return
    if (!(e.target instanceof Node && sub?.contains(e.target))) return
    e.preventDefault()
    e.stopPropagation()
    const r = row
    show()
    r?.focus()
  }
  return (
    <div ref={box} class={styles.root} role="presentation" onKeyDown={onKeyDown}>
      <NavMenu
        items={props.items}
        open={open()?.id}
        onSelect={onSelect}
        onHover={onHover}
        onExpand={(id, el) => show(id, el, true)}
        onClose={props.onClose}
        focusFirst={props.focusFirst}
      />
      <Show when={open()?.id} keyed>
        {(id) => (
          <div ref={sub} class={styles.sub} style={{ left: `${pos().left}px`, top: `${pos().top}px` }}>
            <ParentContext.Provider value={{ side, attach }}>{props.submenu(id)}</ParentContext.Provider>
          </div>
        )}
      </Show>
    </div>
  )
}
