import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './AudioPlayer.module.css'

export interface AudioPlayerProps {
  src: string
  /** 波形（区間ごとの音の大きさを、0〜255 にしたもの）。なければ、真ん中に小さな点を並べる。 */
  wave?: Uint8Array | null
  name: string
  /** 置き場所の側で大きさを決めるとき。 */
  class?: string
}

/** 棒の幅と、棒と次の棒の間（CSS px）。src-tauri/src/thumb.rs の WAVE_BAR・WAVE_GAP と合わせる。 */
const BAR = 3
const GAP = 1

/**
 * 枠の幅いっぱいに、波形を要素の color で描く。幅を棒に分け、棒ごとに区間の大きさの二乗平均の平方根を、
 * 真ん中から上下に同じ長さで伸ばした角丸の棒にする。いちばん大きい棒を枠の高さに合わせる。
 */
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

/** 音声の波形と、その下に続けて置く操作の帯。波形を押すか引くと、その位置へ移る。 */
export function AudioPlayer(props: AudioPlayerProps) {
  let area!: HTMLDivElement
  let base!: HTMLCanvasElement
  let done!: HTMLCanvasElement
  const [audio, setAudio] = createSignal<HTMLAudioElement>()
  const [box, setBox] = createSignal({ w: 0, h: 0 })
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  createEffect(() => {
    const { w, h } = box()
    const wave = props.wave
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
    onCleanup(() => ro.disconnect())
  })
  const played = () => (length() > 0 ? Math.min(100, (at() / length()) * 100) : 0)
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <div ref={area} class={styles.wave} role="img" aria-label={props.name} onPointerDown={onDown}>
        <canvas ref={base} class={styles.base} />
        <canvas ref={done} class={styles.done} style={{ 'clip-path': `inset(0 ${100 - played()}% 0 0)` }} />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
      <audio ref={setAudio} src={props.src} preload="metadata" />
      <PlayerBar media={audio} class={styles.bar} />
    </div>
  )
}
