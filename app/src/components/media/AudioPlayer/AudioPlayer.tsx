import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
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

function draw(canvas: HTMLCanvasElement, wave: Uint8Array | null | undefined, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1
  const cw = Math.max(1, Math.round(w * dpr))
  const ch = Math.max(1, Math.round(h * dpr))
  canvas.width = cw
  canvas.height = ch
  const g = canvas.getContext('2d')
  if (!g) return
  g.fillStyle = getComputedStyle(canvas).color
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
  const pitch = cw / count
  const bw = BAR * dpr
  for (let k = 0; k < count; k++) {
    const len = Math.max(bw, top > 0 ? ((levels[k] ?? 0) / top) * ch : 0)
    g.beginPath()
    g.roundRect(k * pitch + (pitch - bw) / 2, (ch - len) / 2, bw, len, bw / 2)
    g.fill()
  }
}

export function AudioPlayer(props: AudioPlayerProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>()
  let area!: HTMLDivElement
  let base!: HTMLCanvasElement
  let done!: HTMLCanvasElement
  const [audio, setAudio] = createSignal<HTMLAudioElement>()
  const [box, setBox] = createSignal({ w: 0, h: 0 })
  const [theme, setTheme] = createSignal(0)
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  createEffect(() => {
    const { w, h } = box()
    const wave = props.wave
    theme()
    if (!w || !h) return
    draw(base, wave, w, h)
    draw(done, wave, w, h)
  })
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
    // 波形の色は描くときに読むので、テーマが変わったら描き直す
    const mo = new MutationObserver(() => setTheme((n) => n + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    onCleanup(() => {
      ro.disconnect()
      mo.disconnect()
    })
  })
  const played = () => (length() > 0 ? Math.min(100, (at() / length()) * 100) : 0)
  return (
    <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`}>
      <div ref={area} class={styles.wave} role="img" aria-label={props.name} onPointerDown={onDown}>
        <canvas ref={base} class={styles.base} />
        <canvas ref={done} class={styles.done} style={{ 'clip-path': `inset(0 ${100 - played()}% 0 0)` }} />
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
