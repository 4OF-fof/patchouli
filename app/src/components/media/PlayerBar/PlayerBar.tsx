import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { clock } from './clock'
import styles from './PlayerBar.module.css'

export interface PlayerBarProps {
  /** 操る動画や音声。描いたあとに決まるので、関数で渡す。 */
  media: () => HTMLMediaElement | undefined
  fullscreen?: () => HTMLElement | undefined
  class?: string
}

const RATES = [1, 1.5, 2, 0.5]

const SKIP = 5

const pct = (v: number, max: number) => `${max > 0 ? Math.min(100, (v / max) * 100) : 0}%`

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !!t.closest('input:not([type="range"]), select, textarea, [contenteditable], [role="dialog"], [role="menu"]')

export function PlayerBar(props: PlayerBarProps) {
  const [playing, setPlaying] = createSignal(false)
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  const [muted, setMuted] = createSignal(false)
  const [volume, setVolume] = createSignal(1)
  const [rate, setRate] = createSignal(1)
  const [full, setFull] = createSignal(false)
  createEffect(() => {
    const m = props.media()
    if (!m) return
    let frame = 0
    // timeupdate は間が空くので、再生中は描くたびに読む
    const tick = () => {
      setAt(m.currentTime)
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      setPlaying(!m.paused)
      setAt(m.currentTime)
      setLength(Number.isFinite(m.duration) ? m.duration : 0)
      setMuted(m.muted)
      setVolume(m.volume)
      setRate(m.playbackRate)
      cancelAnimationFrame(frame)
      if (!m.paused) frame = requestAnimationFrame(tick)
    }
    const events = ['play', 'pause', 'ended', 'seeked', 'timeupdate', 'durationchange', 'volumechange', 'ratechange']
    for (const e of events) m.addEventListener(e, sync)
    sync()
    onCleanup(() => {
      cancelAnimationFrame(frame)
      for (const e of events) m.removeEventListener(e, sync)
    })
  })
  const toggle = () => {
    const m = props.media()
    if (!m) return
    if (m.paused) void m.play().catch(() => undefined)
    else m.pause()
  }
  const seekTo = (t: number) => {
    const m = props.media()
    if (m) m.currentTime = Math.min(Math.max(0, t), m.duration || 0)
  }
  const toggleMute = () => {
    const m = props.media()
    if (m) m.muted = !m.muted
  }
  const nextRate = () => {
    const m = props.media()
    if (m) m.playbackRate = RATES[(RATES.indexOf(m.playbackRate) + 1) % RATES.length] ?? 1
  }
  const toggleFull = () => {
    const el = props.fullscreen?.()
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => undefined)
  }
  const onFull = () => setFull(!!document.fullscreenElement)
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
    if (e.key === ' ') {
      // ボタンにフォーカスがあっても、押したことにはせず再生を切り替える
      e.preventDefault()
      if (e.type === 'keydown' && !e.repeat) toggle()
    } else if (e.type !== 'keydown') return
    else if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      seekTo((props.media()?.currentTime ?? 0) + (e.key === 'ArrowLeft' ? -SKIP : SKIP))
    } else if (!e.shiftKey && e.key.toLowerCase() === 'm') toggleMute()
  }
  onMount(() => {
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    document.addEventListener('fullscreenchange', onFull)
  })
  onCleanup(() => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
    document.removeEventListener('fullscreenchange', onFull)
  })
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} role="group" aria-label="再生の操作">
      <button
        type="button"
        class={styles.btn}
        aria-label={playing() ? '一時停止' : '再生'}
        title={playing() ? '一時停止（Space）' : '再生（Space）'}
        onClick={toggle}
      >
        <Icon name={playing() ? 'pause' : 'play'} />
      </button>
      <span class={styles.time}>{clock(at())}</span>
      <input
        type="range"
        class={styles.range}
        aria-label="再生位置"
        min={0}
        max={length() || 0}
        step="any"
        value={at()}
        style={{ '--p': pct(at(), length()) }}
        onInput={(e) => seekTo(e.currentTarget.valueAsNumber)}
      />
      <span class={styles.time}>{clock(length())}</span>
      <button type="button" class={styles.rate} aria-label="再生速度" title="再生速度" onClick={nextRate}>
        {rate()}×
      </button>
      <span class={styles.vol}>
        <button
          type="button"
          class={styles.btn}
          aria-label={muted() ? '消音を解除' : '消音'}
          title={muted() ? '消音を解除（M）' : '消音（M）'}
          onClick={toggleMute}
        >
          <Icon name={muted() || volume() === 0 ? 'muted' : 'volume'} />
        </button>
        <input
          type="range"
          class={`${styles.range} ${styles.level}`}
          aria-label="音量"
          min={0}
          max={1}
          step={0.05}
          value={muted() ? 0 : volume()}
          style={{ '--p': pct(muted() ? 0 : volume(), 1) }}
          onInput={(e) => {
            const m = props.media()
            if (!m) return
            m.volume = e.currentTarget.valueAsNumber
            m.muted = m.volume === 0
          }}
        />
      </span>
      <Show when={props.fullscreen}>
        <button
          type="button"
          class={styles.btn}
          aria-label={full() ? '全画面を終了' : '全画面'}
          title={full() ? '全画面を終了' : '全画面'}
          onClick={toggleFull}
        >
          <Icon name={full() ? 'unfullscreen' : 'fullscreen'} />
        </button>
      </Show>
    </div>
  )
}
