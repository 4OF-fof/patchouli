import { type JSX, Show, createContext, createSignal, onCleanup, onMount, useContext } from 'solid-js'
import styles from './Selection.module.css'

/** 選んでいる項目。画面をまたいで 1 つだけ持ち、画面を移ると外す。 */
export interface Selection {
  ids: () => string[]
  has: (id: string) => boolean
  set: (ids: string[]) => void
  clear: () => void
  toggle: (id: string) => void
  /** 前に押した項目から id までを、order の並びで足す。 */
  extend: (id: string, order: string[]) => void
  /** Delete キーを押したとき。 */
  onDelete?: (ids: string[]) => void
}

export function createSelection(onDelete?: (ids: string[]) => void): Selection {
  const [ids, setIds] = createSignal<string[]>([])
  let anchor: string | undefined
  return {
    ids,
    has: (id) => ids().includes(id),
    set: (next) => {
      setIds(next)
      anchor = next.at(-1)
    },
    clear: () => {
      setIds([])
      anchor = undefined
    },
    toggle: (id) => {
      setIds(ids().includes(id) ? ids().filter((x) => x !== id) : [...ids(), id])
      anchor = id
    },
    extend: (id, order) => {
      const a = order.indexOf(anchor ?? id)
      const b = order.indexOf(id)
      if (b < 0) return
      const [from, to] = a < 0 ? [b, b] : a < b ? [a, b] : [b, a]
      setIds([...new Set([...ids(), ...order.slice(from, to + 1)])])
    },
    onDelete,
  }
}

const Global = createContext<Selection>()

/** アプリ全体で 1 つの選択を配る。なければ、選べる範囲ごとに持つ。 */
export const SelectionProvider = Global.Provider
export const useSelection = () => useContext(Global)

interface Area {
  sel: Selection
  /** カードを押したとき。選んでいなければ open を呼ぶ。 */
  click: (e: MouseEvent, id: string, open: () => void) => void
}

const AreaContext = createContext<Area>()

/** 中のカード（ItemCard）が、選べるかどうかと押したときの動きを知るのに使う。 */
export const useSelectArea = () => useContext(AreaContext)

export interface SelectAreaProps {
  /** 中の項目の並び。Shift で範囲を選ぶときと、Ctrl A に使う。 */
  order: () => string[]
  class?: string
  children: JSX.Element
}

type Rect = { x0: number; y0: number; x1: number; y1: number }

const MOVED = 4
const SKIP = 'button, a, input, textarea, select, label, [role="tab"], [contenteditable="true"]'

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || !!t.closest('input, textarea, select'))

/**
 * カードを選べる範囲。Ctrl か Shift を押しているあいだはカードに選ぶ印を出し、空いた所からのドラッグで囲んで選ぶ。
 * 空いた所を押すか Esc で選択を外し、Ctrl A ですべて選ぶ。
 */
export function SelectArea(props: SelectAreaProps) {
  const sel = useSelection() ?? createSelection()
  const [mod, setMod] = createSignal(false)
  const [rect, setRect] = createSignal<Rect>()
  let el!: HTMLDivElement
  let base: string[] = []
  let dragged = false

  const click = (e: MouseEvent, id: string, open: () => void) => {
    if (e.shiftKey) sel.extend(id, props.order())
    else if (e.ctrlKey || e.metaKey || sel.ids().length) sel.toggle(id)
    else open()
  }

  const onKey = (e: KeyboardEvent) => {
    setMod(e.ctrlKey || e.metaKey || e.shiftKey)
    if (e.type !== 'keydown' || e.defaultPrevented || typing(e.target)) return
    if (e.key === 'Escape' && sel.ids().length) {
      e.preventDefault()
      sel.clear()
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      sel.set(props.order())
    } else if (e.key === 'Delete' && sel.ids().length && sel.onDelete) {
      e.preventDefault()
      sel.onDelete(sel.ids())
    }
  }
  const offMod = () => setMod(false)
  onMount(() => {
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', offMod)
  })
  onCleanup(() => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
    window.removeEventListener('blur', offMod)
  })

  const onDown = (e: PointerEvent) => {
    dragged = false
    if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(`${SKIP}, [data-select]`)) return
    base = e.ctrlKey || e.metaKey || e.shiftKey ? sel.ids() : []
    setRect({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
    el.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    const r = rect()
    if (!r) return
    const next = { ...r, x1: e.clientX, y1: e.clientY }
    setRect(next)
    if (!dragged && Math.abs(next.x1 - next.x0) + Math.abs(next.y1 - next.y0) <= MOVED) return
    dragged = true
    const [l, rr] = [Math.min(next.x0, next.x1), Math.max(next.x0, next.x1)]
    const [t, b] = [Math.min(next.y0, next.y1), Math.max(next.y0, next.y1)]
    const hits = [...el.querySelectorAll<HTMLElement>('[data-select]')]
      .filter((c) => {
        const box = c.getBoundingClientRect()
        return box.left < rr && box.right > l && box.top < b && box.bottom > t
      })
      .flatMap((c) => c.dataset.select ?? [])
    sel.set([...new Set([...base, ...hits])])
  }
  const onUp = () => setRect(undefined)
  const onClick = (e: MouseEvent) => {
    if (dragged || !(e.target instanceof Element) || e.target.closest(`${SKIP}, [data-select]`)) return
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) sel.clear()
  }
  const box = () => {
    const r = rect()
    if (!r || !dragged) return undefined
    return {
      left: `${Math.min(r.x0, r.x1)}px`,
      top: `${Math.min(r.y0, r.y1)}px`,
      width: `${Math.abs(r.x1 - r.x0)}px`,
      height: `${Math.abs(r.y1 - r.y0)}px`,
    }
  }

  return (
    <AreaContext.Provider value={{ sel, click }}>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 空いた所を押して選択を外す。キーボードでは Esc で外す */}
      <div
        ref={el}
        class={`${styles.root} ${props.class ?? ''}`}
        data-mod={mod() || undefined}
        data-dragging={!!rect() || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={onClick}
      >
        {props.children}
        <Show when={box()}>{(s) => <div class={styles.rect} style={s()} />}</Show>
      </div>
    </AreaContext.Provider>
  )
}
