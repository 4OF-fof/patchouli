import { type JSX, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import { clock } from '../PlayerBar/clock'
import { undecodable } from '../PlayerBar/undecodable'
import styles from './AudioPlayer.module.css'
import { loadArt, paintStage, paintWave, toneOf } from './jacket'

export interface AudioPlayerProps {
  src: string
  wave?: Uint8Array | null
  name: string
  /** stage は置き場所いっぱいに波形を描き、下に操作の帯を出す。row は再生のボタン・波形・時間・音量を 1 行に並べる */
  look?: 'stage' | 'row'
  /** stage では、ぼかして背景に敷き、波形の棒をその絵で切り抜く。row では左端に出す */
  jacket?: string
  /** stage で、波形の上に出すもの */
  children?: JSX.Element
  /** キーを、この中にフォーカスがあるときだけ受ける */
  local?: boolean
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
  /** WebView のデコーダーが形式に対応していなかったとき */
  onUnsupported?: () => void
}

/** 棒の幅と、棒と次の棒の間（CSS px）。stage は src-tauri/src/thumb.rs の WAVE_BAR・WAVE_GAP と合わせる。 */
const BARS = { stage: [5, 2], row: [3, 1] } as const

function wavePath(wave: Uint8Array | null | undefined, w: number, h: number, [BAR, GAP]: readonly [number, number]) {
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
  const look = () => props.look ?? 'stage'
  const path = createMemo(() => {
    const { w, h } = box()
    return w && h ? wavePath(props.wave, w, h, BARS[look()]) : ''
  })
  const [art] = createResource(
    () => (look() === 'stage' ? props.jacket : undefined),
    (src) => loadArt(src).catch(() => null),
  )
  const shownArt = () => (look() === 'stage' && props.jacket ? (art.latest ?? undefined) : undefined)
  const [backdrop, setBackdrop] = createSignal<HTMLCanvasElement>()
  const [baseCv, setBaseCv] = createSignal<HTMLCanvasElement>()
  const [doneCv, setDoneCv] = createSignal<HTMLCanvasElement>()
  const [stage, setStage] = createSignal({ w: 0, h: 0 })
  const [theme, setTheme] = createSignal(0)
  createEffect(() => {
    const r = root()
    if (!r || !shownArt()) return
    const ro = new ResizeObserver(() => setStage({ w: r.clientWidth, h: r.clientHeight }))
    ro.observe(r)
    const mo = new MutationObserver(() => setTheme((n) => n + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    onCleanup(() => {
      ro.disconnect()
      mo.disconnect()
    })
  })
  createEffect(() => {
    const a = shownArt()
    const [r, bg, base, done] = [root(), backdrop(), baseCv(), doneCv()]
    const s = stage()
    const { w, h } = box()
    const d = path()
    theme()
    if (!a || !r || !bg || !base || !done || !s.w || !s.h || !w || !h) return
    const tone = toneOf(a, getComputedStyle(r).getPropertyValue('--stage').trim())
    const [R, A] = [r.getBoundingClientRect(), area.getBoundingClientRect()]
    paintStage(bg, a, tone, s.w, s.h)
    paintWave({ base, done }, a, tone, s, { x: A.left - R.left, y: A.top - R.top, w, h }, d)
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
  const clip = () => `inset(0 ${100 - played()}% 0 0)`
  const [brokenJacket, setBrokenJacket] = createSignal<string>()
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
      <Show
        when={shownArt()}
        fallback={
          <>
            <svg class={styles.base} viewBox={view()} aria-hidden="true">
              <path d={path()} />
            </svg>
            <svg class={styles.done} viewBox={view()} aria-hidden="true" style={{ 'clip-path': clip() }}>
              <path d={path()} />
            </svg>
          </>
        }
      >
        <canvas ref={setBaseCv} class={styles.base} aria-hidden="true" />
        <canvas ref={setDoneCv} class={styles.done} aria-hidden="true" style={{ 'clip-path': clip() }} />
      </Show>
      <Show when={look() === 'stage'}>
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
      onError={(e) => {
        if (undecodable(e.currentTarget.error)) props.onUnsupported?.()
        props.onReady?.()
      }}
    />
  )
  return (
    <Show
      when={look() === 'row'}
      fallback={
        <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`} data-look="stage">
          <Show when={shownArt()}>
            <canvas ref={setBackdrop} class={styles.backdrop} aria-hidden="true" />
          </Show>
          {props.children}
          <div class={styles.body}>
            <div class={styles.box}>{wave}</div>
            {media}
            <PlayerBar media={audio} scope={props.local ? root : undefined} class={styles.bar} />
          </div>
        </div>
      }
    >
      <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`} data-look="row">
        {media}
        <PlayerBar
          media={audio}
          scope={props.local ? root : undefined}
          layout="row"
          lead={
            <Show when={props.jacket !== brokenJacket() && props.jacket}>
              {(src) => <img class={styles.jacket} src={src()} alt="" onError={() => setBrokenJacket(src())} />}
            </Show>
          }
          track={wave}
        />
      </div>
    </Show>
  )
}
