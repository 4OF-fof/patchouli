import { type JSX, type Ref, createSignal, onCleanup, onMount, splitProps } from 'solid-js'
import styles from './ScrollArea.module.css'

export interface ScrollAreaProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'ref' | 'class'> {
  class?: string
  viewClass?: string
  ref?: Ref<HTMLDivElement>
  axis?: 'y' | 'x'
}

export function ScrollArea(props: ScrollAreaProps) {
  const [local, rest] = splitProps(props, ['class', 'viewClass', 'ref', 'axis', 'children'])
  let view!: HTMLDivElement
  let track!: HTMLDivElement
  const x = () => local.axis === 'x'
  const [thumb, setThumb] = createSignal({ size: 0, at: 0 })
  const [scrolling, setScrolling] = createSignal(false)
  const [near, setNear] = createSignal(false)
  const [dragging, setDragging] = createSignal(false)

  const dims = () => {
    const len = x() ? view.clientWidth : view.clientHeight
    const full = x() ? view.scrollWidth : view.scrollHeight
    const pos = x() ? view.scrollLeft : view.scrollTop
    const room = x() ? track.clientWidth : track.clientHeight
    return { len, full, pos, room }
  }
  const measure = () => {
    const { len, full, pos, room } = dims()
    if (full <= len + 1) {
      setThumb({ size: 0, at: 0 })
      return
    }
    const size = Math.max(24, (room * len) / full)
    setThumb({ size, at: ((room - size) * pos) / (full - len) })
  }

  let idle = 0
  const onScroll = () => {
    measure()
    setScrolling(true)
    clearTimeout(idle)
    idle = window.setTimeout(() => setScrolling(false), 900)
  }
  const onMove = (e: PointerEvent) => {
    const r = view.getBoundingClientRect()
    setNear(x() ? r.bottom - e.clientY < 24 : r.right - e.clientX < 24)
  }
  const scrollTo = (pos: number) => {
    if (x()) view.scrollLeft = pos
    else view.scrollTop = pos
  }
  const onThumbDown = (e: PointerEvent) => {
    const el = e.currentTarget
    if (!(el instanceof HTMLElement)) return
    e.preventDefault()
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const start = x() ? e.clientX : e.clientY
    const { len, full, pos, room } = dims()
    const per = (full - len) / (room - thumb().size)
    setDragging(true)
    const move = (m: PointerEvent) => scrollTo(pos + ((x() ? m.clientX : m.clientY) - start) * per)
    const up = () => {
      setDragging(false)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onTrackDown = (e: PointerEvent) => {
    const r = track.getBoundingClientRect()
    const at = (x() ? e.clientX - r.left : e.clientY - r.top) < thumb().at ? -1 : 1
    const by = at * dims().len * 0.9
    view.scrollBy(x() ? { left: by, behavior: 'smooth' } : { top: by, behavior: 'smooth' })
  }

  onMount(() => {
    const ro = new ResizeObserver(measure)
    const watch = () => {
      ro.disconnect()
      ro.observe(view)
      for (const c of view.children) ro.observe(c)
    }
    const mo = new MutationObserver(() => {
      watch()
      measure()
    })
    watch()
    mo.observe(view, { childList: true })
    measure()
    onCleanup(() => {
      ro.disconnect()
      mo.disconnect()
      clearTimeout(idle)
    })
  })

  return (
    <div
      class={`${styles.root} ${local.class ?? ''}`}
      data-axis={x() ? 'x' : 'y'}
      onPointerMove={onMove}
      onPointerLeave={() => setNear(false)}
    >
      <div
        {...rest}
        class={`${styles.view} ${local.viewClass ?? ''}`}
        ref={(el) => {
          view = el
          if (typeof local.ref === 'function') local.ref(el)
        }}
        onScroll={onScroll}
      >
        {local.children}
      </div>
      <div
        class={styles.track}
        ref={track}
        data-shown={thumb().size > 0 && (scrolling() || near() || dragging())}
        data-active={near() || dragging()}
        onPointerDown={onTrackDown}
        aria-hidden="true"
      >
        <div
          class={styles.thumb}
          style={{
            [x() ? 'width' : 'height']: `${thumb().size}px`,
            transform: x() ? `translateX(${thumb().at}px)` : `translateY(${thumb().at}px)`,
          }}
          onPointerDown={onThumbDown}
        />
      </div>
    </div>
  )
}
