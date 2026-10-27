import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import styles from './ImageZoom.module.css'
import { Icon } from '../../base/Icon/Icon'

export interface ImageZoomProps {
  src: string
  name: string
  class?: string
}

const MAX = 16
const STEP = 1.25

const fitIn = (v: number, size: number, room: number) =>
  size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, v))

export function ImageZoom(props: ImageZoomProps) {
  let view!: HTMLDivElement
  const [box, setBox] = createSignal({ w: 0, h: 0 })
  const [natural, setNatural] = createSignal({ w: 0, h: 0 })
  const [zoom, setZoom] = createSignal<number | null>(null)
  const [pos, setPos] = createSignal({ x: 0, y: 0 })
  const [dragging, setDragging] = createSignal(false)
  const fit = () => {
    const n = natural()
    const b = box()
    return n.w && n.h && b.w && b.h ? Math.min(1, b.w / n.w, b.h / n.h) : 1
  }
  const scale = () => zoom() ?? fit()
  const min = () => Math.min(fit(), 1)
  const clamp = (p: { x: number; y: number }, s: number) => {
    const n = natural()
    const b = box()
    return { x: fitIn(p.x, n.w * s, b.w), y: fitIn(p.y, n.h * s, b.h) }
  }
  const shown = () => clamp(pos(), scale())
  const zoomAt = (s: number, cx: number, cy: number) => {
    const next = Math.min(MAX, Math.max(min(), s))
    const now = scale()
    const p = shown()
    setPos(clamp({ x: cx - ((cx - p.x) * next) / now, y: cy - ((cy - p.y) * next) / now }, next))
    setZoom(next)
  }
  const zoomCenter = (s: number) => zoomAt(s, box().w / 2, box().h / 2)
  const reset = () => {
    setZoom(null)
    setPos({ x: 0, y: 0 })
  }
  createEffect(on(() => props.src, reset, { defer: true }))
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const r = view.getBoundingClientRect()
    zoomAt(scale() * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
  }
  const pannable = () => {
    const n = natural()
    const b = box()
    return n.w * scale() > b.w + 0.5 || n.h * scale() > b.h + 0.5
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !pannable()) return
    e.preventDefault()
    view.setPointerCapture(e.pointerId)
    setDragging(true)
    const start = { x: e.clientX, y: e.clientY, p: shown() }
    const move = (m: PointerEvent) =>
      setPos(clamp({ x: start.p.x + m.clientX - start.x, y: start.p.y + m.clientY - start.y }, scale()))
    const up = () => {
      setDragging(false)
      view.removeEventListener('pointermove', move)
      view.removeEventListener('pointerup', up)
      view.removeEventListener('pointercancel', up)
    }
    view.addEventListener('pointermove', move)
    view.addEventListener('pointerup', up)
    view.addEventListener('pointercancel', up)
  }
  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(view)
    // ホイールで画面ごと動かないよう、passive にしない
    view.addEventListener('wheel', onWheel, { passive: false })
    onCleanup(() => {
      ro.disconnect()
      view.removeEventListener('wheel', onWheel)
    })
  })
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <div
        ref={view}
        class={styles.view}
        data-pan={pannable() || undefined}
        data-dragging={dragging() || undefined}
        onPointerDown={onDown}
      >
        <img
          class={styles.img}
          src={props.src}
          alt={props.name}
          draggable={false}
          data-ready={natural().w > 0 || undefined}
          style={{
            width: `${natural().w}px`,
            height: `${natural().h}px`,
            transform: `translate(${shown().x}px, ${shown().y}px) scale(${scale()})`,
          }}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      </div>
      <div class={styles.bar} role="group" aria-label="表示倍率">
        <button type="button" class={styles.btn} aria-label="縮小" onClick={() => zoomCenter(scale() / STEP)}>
          <Icon name="minus" size={14} />
        </button>
        <span class={styles.pct}>{Math.round(scale() * 100)}%</span>
        <button type="button" class={styles.btn} aria-label="拡大" onClick={() => zoomCenter(scale() * STEP)}>
          <Icon name="plus" size={14} />
        </button>
        <button type="button" class={styles.mode} aria-pressed={zoom() === null} onClick={reset}>
          全体
        </button>
        <button type="button" class={styles.mode} aria-pressed={zoom() === 1} onClick={() => zoomCenter(1)}>
          等倍
        </button>
      </div>
    </div>
  )
}
