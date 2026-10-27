import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './AudioPlayer.module.css'

export interface AudioPlayerProps {
  src: string
  /** 波形（各点の音の大きさを 0〜255 にしたもの）。なければ、真ん中に線だけ引く。 */
  peaks?: Uint8Array | null
  name: string
  /** 置き場所の側で大きさを決めるとき。 */
  class?: string
}

/** 枠の幅いっぱいに、上下に対称な波形を、要素の color で描く。いちばん大きい山を枠の高さに合わせる。 */
function draw(canvas: HTMLCanvasElement, peaks: Uint8Array | null | undefined, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1
  const cw = Math.max(1, Math.round(w * dpr))
  const ch = Math.max(1, Math.round(h * dpr))
  canvas.width = cw
  canvas.height = ch
  const g = canvas.getContext('2d')
  if (!g) return
  g.fillStyle = getComputedStyle(canvas).color
  const n = peaks?.length ?? 0
  const top = Math.max(1, ...(peaks ?? []))
  const mid = ch / 2
  for (let x = 0; x < cw; x++) {
    let v = 0
    if (peaks && n > 0) {
      const from = Math.floor((x * n) / cw)
      const to = Math.max(from + 1, Math.floor(((x + 1) * n) / cw))
      for (let i = from; i < to && i < n; i++) v = Math.max(v, peaks[i] ?? 0)
    }
    const half = Math.max(dpr / 2, (v / top) * mid)
    g.fillRect(x, mid - half, 1, half * 2)
  }
}

/** 音声の波形と、その下に続けて置く操作の帯。波形を押すか引くと、その位置へ移る。 */
export function AudioPlayer(props: AudioPlayerProps) {
  let wave!: HTMLDivElement
  let base!: HTMLCanvasElement
  let done!: HTMLCanvasElement
  const [audio, setAudio] = createSignal<HTMLAudioElement>()
  const [box, setBox] = createSignal({ w: 0, h: 0 })
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  createEffect(() => {
    const { w, h } = box()
    const peaks = props.peaks
    if (!w || !h) return
    draw(base, peaks, w, h)
    draw(done, peaks, w, h)
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
    const r = wave.getBoundingClientRect()
    if (!m || !r.width || !Number.isFinite(m.duration)) return
    m.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * m.duration
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    wave.setPointerCapture(e.pointerId)
    seekAt(e.clientX)
    const move = (m: PointerEvent) => seekAt(m.clientX)
    const up = () => {
      wave.removeEventListener('pointermove', move)
      wave.removeEventListener('pointerup', up)
      wave.removeEventListener('pointercancel', up)
    }
    wave.addEventListener('pointermove', move)
    wave.addEventListener('pointerup', up)
    wave.addEventListener('pointercancel', up)
  }
  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(wave)
    onCleanup(() => ro.disconnect())
  })
  const played = () => (length() > 0 ? Math.min(100, (at() / length()) * 100) : 0)
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <div ref={wave} class={styles.wave} role="img" aria-label={props.name} onPointerDown={onDown}>
        <canvas ref={base} class={styles.base} />
        <canvas ref={done} class={styles.done} style={{ 'clip-path': `inset(0 ${100 - played()}% 0 0)` }} />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
      <audio ref={setAudio} src={props.src} preload="metadata" />
      <PlayerBar media={audio} class={styles.bar} />
    </div>
  )
}
