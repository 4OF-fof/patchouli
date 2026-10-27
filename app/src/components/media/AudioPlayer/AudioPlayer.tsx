import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './AudioPlayer.module.css'

export interface AudioPlayerProps {
  src: string
  /** 波形（等間隔に拾った音の値を、符号付き 8 bit にしたもの）。なければ、真ん中に線だけ引く。 */
  wave?: Uint8Array | null
  name: string
  /** 置き場所の側で大きさを決めるとき。 */
  class?: string
}

/** 波形の 1 区間の幅（CSS px）。src-tauri/src/thumb.rs の WAVE_STEP と合わせる。 */
const STEP = 2

/**
 * 枠の幅いっぱいに、波形を要素の color で描く。幅を STEP ずつの区間に分け、区間ごとの最大を上、最小を下として、
 * 隣の区間と線でつないで塗る。いちばん大きく振れたところを枠の高さに合わせる。
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
  const vals = wave ? new Int8Array(wave.buffer, wave.byteOffset, wave.length) : new Int8Array(1)
  const n = vals.length
  const mid = ch / 2
  const scale = Math.max(1, ...Array.from(vals, Math.abs)) / mid
  const parts = Math.max(1, Math.floor(w / STEP))
  const xs: number[] = []
  const tops: number[] = []
  const bottoms: number[] = []
  for (let k = 0; k < parts; k++) {
    const from = Math.min(n - 1, Math.floor((k * n) / parts))
    const to = Math.min(n, Math.max(from + 1, Math.floor(((k + 1) * n) / parts)))
    let lo = Infinity
    let hi = -Infinity
    for (let i = from; i < to; i++) {
      const v = vals[i] ?? 0
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    let top = mid - hi / scale
    let bottom = mid - lo / scale
    // 無音でも線は残す
    if (bottom - top < dpr) {
      const c = (top + bottom) / 2
      top = c - dpr / 2
      bottom = c + dpr / 2
    }
    xs.push(((k + 0.5) * cw) / parts)
    tops.push(top)
    bottoms.push(bottom)
  }
  g.beginPath()
  g.moveTo(0, tops[0] ?? mid)
  xs.forEach((x, k) => g.lineTo(x, tops[k] ?? mid))
  g.lineTo(cw, tops.at(-1) ?? mid)
  g.lineTo(cw, bottoms.at(-1) ?? mid)
  for (let k = parts - 1; k >= 0; k--) g.lineTo(xs[k] ?? 0, bottoms[k] ?? mid)
  g.lineTo(0, bottoms[0] ?? mid)
  g.closePath()
  g.fill()
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
