import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './AudioPlayer.module.css'

export interface AudioPlayerProps {
  src: string
  wave?: Uint8Array | null
  name: string
  /** キーを、この中にフォーカスがあるときだけ受ける */
  local?: boolean
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
}

/** 棒の幅と、棒と次の棒の間（CSS px）。src-tauri/src/thumb.rs の WAVE_BAR・WAVE_GAP と合わせる。 */
const BAR = 3
const GAP = 1

function wavePath(wave: Uint8Array | null | undefined, w: number, h: number) {
  const vals = wave ?? new Uint8Array(1)
  const n = vals.length
  const count = Math.max(1, Math.floor((w + GAP) / (BAR + GAP)))
  const levels: number[] = []
  for (let k = 0; k < count; k++) {
    const from = Math.min(n - 1, Math.floor((k * n) / count))
    const to = Math.min(n, Math.max(from + 1, Math.floor(((k + 1) * n) / count)))
    let sq = 0
    for (let i = from; i < to; i++) sq += (vals[i] ?? 0) ** 2
    levels.push(Math.sqrt(sq / (to - from)))
  }
  const top = Math.max(...levels)
  const pitch = w / count
  const r = BAR / 2
  const f = (v: number) => +v.toFixed(2)
  let d = ''
  for (let k = 0; k < count; k++) {
    const len = Math.max(BAR, top > 0 ? ((levels[k] ?? 0) / top) * h : 0)
    const x = k * pitch + (pitch - BAR) / 2
    const y = (h - len) / 2
    d += `M${f(x)} ${f(y + r)}a${r} ${r} 0 0 1 ${BAR} 0v${f(len - BAR)}a${r} ${r} 0 0 1 ${-BAR} 0z`
  }
  return d
}

export function AudioPlayer(props: AudioPlayerProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>()
  let area!: HTMLDivElement
  const [audio, setAudio] = createSignal<HTMLAudioElement>()
  const [box, setBox] = createSignal({ w: 0, h: 0 })
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  const path = createMemo(() => {
    const { w, h } = box()
    return w && h ? wavePath(props.wave, w, h) : ''
  })
  const view = () => `0 0 ${box().w || 1} ${box().h || 1}`
  createEffect(() => {
    const m = audio()
    if (!m) return
    let frame = 0
    const tick = () => {
      setAt(m.currentTime)
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      setAt(m.currentTime)
      setLength(Number.isFinite(m.duration) ? m.duration : 0)
      cancelAnimationFrame(frame)
      if (!m.paused) frame = requestAnimationFrame(tick)
    }
    const events = ['play', 'pause', 'ended', 'seeked', 'timeupdate', 'durationchange']
    for (const e of events) m.addEventListener(e, sync)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      for (const e of events) m.removeEventListener(e, sync)
    })
  })
  const seekAt = (clientX: number) => {
    const m = audio()
    const r = area.getBoundingClientRect()
    if (!m || !r.width || !Number.isFinite(m.duration)) return
    m.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * m.duration
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    area.setPointerCapture(e.pointerId)
    seekAt(e.clientX)
    const move = (m: PointerEvent) => seekAt(m.clientX)
    const up = () => {
      area.removeEventListener('pointermove', move)
      area.removeEventListener('pointerup', up)
      area.removeEventListener('pointercancel', up)
    }
    area.addEventListener('pointermove', move)
    area.addEventListener('pointerup', up)
    area.addEventListener('pointercancel', up)
  }
  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(area)
    onCleanup(() => ro.disconnect())
  })
  const played = () => (length() > 0 ? Math.min(100, (at() / length()) * 100) : 0)
  return (
    <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`}>
      <div ref={area} class={styles.wave} role="img" aria-label={props.name} onPointerDown={onDown}>
        <svg class={styles.base} viewBox={view()} aria-hidden="true">
          <path d={path()} />
        </svg>
        <svg
          class={styles.done}
          viewBox={view()}
          aria-hidden="true"
          style={{ 'clip-path': `inset(0 ${100 - played()}% 0 0)` }}
        >
          <path d={path()} />
        </svg>
      </div>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
      <audio
        ref={setAudio}
        src={props.src}
        preload="metadata"
        onLoadedMetadata={() => props.onReady?.()}
        onError={() => props.onReady?.()}
      />
      <PlayerBar media={audio} scope={props.local ? root : undefined} class={styles.bar} />
    </div>
  )
}
