import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import { clock } from '../PlayerBar/clock'
import styles from './AudioPlayer.module.css'

export interface AudioPlayerProps {
  src: string
  wave?: Uint8Array | null
  name: string
  /** stage は置き場所いっぱいに波形と目盛りを描き、下に操作の帯を出す。row は再生のボタン・波形・時間・音量を 1 行に並べる */
  look?: 'stage' | 'row'
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

/** 目盛りの間隔（秒）。ラベルが 6 つほどに収まる、いちばん細かいもの。 */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

function ticks(length: number) {
  if (!(length > 0)) return []
  const step = STEPS.find((s) => length / s <= 6) ?? 3600
  const out: { at: number; label: boolean }[] = []
  for (let t = 0; t <= length; t += step / 2) out.push({ at: t / length, label: t % step === 0 })
  return out
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
  const [hover, setHover] = createSignal<number>()
  const hoverAt = (clientX: number) => {
    const r = area.getBoundingClientRect()
    setHover(r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : undefined)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const m = audio()
    if (!m || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.shiftKey) return
    e.preventDefault()
    m.currentTime = Math.min(m.duration || 0, Math.max(0, m.currentTime + (e.key === 'ArrowLeft' ? -5 : 5)))
  }
  const wave = (
    <div
      ref={area}
      class={styles.wave}
      role="slider"
      tabIndex={0}
      aria-label={`${props.name} の再生位置`}
      aria-valuemin={0}
      aria-valuemax={Math.floor(length())}
      aria-valuenow={Math.floor(at())}
      aria-valuetext={clock(at())}
      onPointerDown={onDown}
      onPointerMove={(e) => hoverAt(e.clientX)}
      onPointerLeave={() => setHover(undefined)}
      onKeyDown={onKeyDown}
    >
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
      <Show when={props.look !== 'row'}>
        <Show when={hover() !== undefined && length() > 0}>
          <span class={styles.hover} style={{ left: `${(hover() ?? 0) * 100}%` }}>
            <span class={styles.hoverTime}>{clock((hover() ?? 0) * length())}</span>
          </span>
        </Show>
        <span class={styles.head} style={{ left: `${played()}%` }}>
          <span class={styles.bubble}>{clock(at())}</span>
        </span>
      </Show>
    </div>
  )
  const media = (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない
    <audio
      ref={setAudio}
      src={props.src}
      preload="metadata"
      onLoadedMetadata={() => props.onReady?.()}
      onError={() => props.onReady?.()}
    />
  )
  return (
    <Show
      when={props.look === 'row'}
      fallback={
        <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`} data-look="stage">
          <div class={styles.box}>
            {wave}
            <div class={styles.ruler} aria-hidden="true">
              <For each={ticks(length())}>
                {(t) => (
                  <span class={styles.tick} data-label={t.label || undefined} style={{ left: `${t.at * 100}%` }}>
                    <Show when={t.label}>
                      <span>{clock(t.at * length())}</span>
                    </Show>
                  </span>
                )}
              </For>
            </div>
          </div>
          {media}
          <PlayerBar media={audio} scope={props.local ? root : undefined} class={styles.bar} />
        </div>
      }
    >
      <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`} data-look="row">
        {media}
        <PlayerBar media={audio} scope={props.local ? root : undefined} layout="row" track={wave} />
      </div>
    </Show>
  )
}
