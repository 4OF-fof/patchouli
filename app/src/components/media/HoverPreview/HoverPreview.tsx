import { type JSX, Show, createContext, createSignal, onCleanup, onMount, useContext } from 'solid-js'
import type { Item } from '../../../model/library'
import { prefs } from '../../../model/prefs'
import { useFormats } from '../../../plugins/formats'
import type { Fit, UiRef } from '../../../plugins/types'
import { type UiApi, loadUi } from '../../../plugins/ui'
import { clock } from '../PlayerBar/clock'
import styles from './HoverPreview.module.css'

export interface HoverHost {
  ui?: (item: Item, ui: UiRef) => { url: string; api: UiApi }
}

const Host = createContext<HoverHost>({})

export const HoverHostProvider = Host.Provider

export interface HoverOptions {
  clock?: boolean
}

export function useHoverPreview() {
  const formats = useFormats()
  const host = useContext(Host)
  return (it: Item, opts?: HoverOptions): (() => JSX.Element) | undefined => {
    if (!prefs().hoverPreview) return undefined
    const f = it.note ? undefined : formats().get(it.ext)
    const make = host.ui
    const ui = f?.uiHover
    if (ui && make)
      return () => {
        const p = make(it, ui)
        return <PluginHover url={p.url} api={p.api} />
      }
    const src = it.src
    if (f?.hover === 'video' && src) return () => <VideoHover src={src} fit={it.fit} clock={opts?.clock} />
    if (f?.hover === 'audio' && src)
      return () => <AudioHover src={src} wave={it.waveThumb ? it.thumb : undefined} fit={it.fit} clock={opts?.clock} />
    return undefined
  }
}

const played = (at: number, length: number) => Math.min(100, (at / length) * 100)

/** 再生した位置と長さ。サムネイルの下に重ねる。track がなければ時間だけ出す。 */
function Progress(props: { at: number; length: number; clock?: boolean; track?: boolean }) {
  return (
    <Show when={props.length > 0}>
      <Show when={props.clock ?? true}>
        <span class={styles.time}>
          {clock(props.at)} / {clock(props.length)}
        </span>
      </Show>
      <Show when={props.track ?? true}>
        <span class={styles.track}>
          <span class={styles.done} style={{ width: `${played(props.at, props.length)}%` }} />
        </span>
      </Show>
    </Show>
  )
}

/**
 * 音声はサムネイルをそのまま見せる。波形のサムネイル（wave）なら、その絵を型にして再生したところまでの棒に色を付ける。
 * ジャケットのときは、再生した位置を下の帯で出す。
 */
export function AudioHover(props: { src: string; wave?: string; fit?: Fit; clock?: boolean }) {
  const [ready, setReady] = createSignal(false)
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  let audio!: HTMLAudioElement
  let frame = 0
  const tick = () => {
    setAt(audio.currentTime)
    frame = requestAnimationFrame(tick)
  }
  onMount(() => (frame = requestAnimationFrame(tick)))
  onCleanup(() => cancelAnimationFrame(frame))
  return (
    <span class={styles.root} data-ready={ready()}>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- サムネイルでの短い再生 */}
      <audio
        ref={audio}
        src={props.src}
        muted={!prefs().hoverSound}
        autoplay
        loop
        onPlaying={() => setReady(true)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onDurationChange={(e) => setLength(e.currentTarget.duration)}
      />
      <Show when={ready()}>
        <Show when={props.wave && length() > 0 && props.wave}>
          {(wave) => (
            <span
              class={styles.bars}
              data-fit={props.fit ?? 'center'}
              style={{
                'mask-image': `url("${wave()}")`,
                'clip-path': `inset(0 ${100 - played(at(), length())}% 0 0)`,
              }}
            />
          )}
        </Show>
        <Progress at={at()} length={length()} clock={props.clock} track={!props.wave} />
      </Show>
    </span>
  )
}

export function VideoHover(props: { src: string; fit?: Fit; clock?: boolean }) {
  const [ready, setReady] = createSignal(false)
  const [at, setAt] = createSignal(0)
  const [length, setLength] = createSignal(0)
  let video!: HTMLVideoElement
  let frame = 0
  // timeupdate は間が空くので、見えているあいだは描くたびにも読む
  const tick = () => {
    setAt(video.currentTime)
    frame = requestAnimationFrame(tick)
  }
  onMount(() => (frame = requestAnimationFrame(tick)))
  onCleanup(() => cancelAnimationFrame(frame))
  return (
    <span class={styles.root} data-ready={ready()}>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- サムネイルでの短い再生 */}
      <video
        ref={video}
        class={styles.video}
        data-fit={props.fit ?? 'center'}
        src={props.src}
        muted={!prefs().hoverSound}
        autoplay
        loop
        playsinline
        onPlaying={() => setReady(true)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onDurationChange={(e) => setLength(e.currentTarget.duration)}
      />
      <Show when={ready()}>
        <Progress at={at()} length={length()} clock={props.clock} />
      </Show>
    </span>
  )
}

function PluginHover(props: { url: string; api: UiApi }) {
  let el!: HTMLSpanElement
  let off: (() => void) | undefined
  let closed = false
  onMount(() => {
    const { url, api } = props
    loadUi(url)
      .then((mod) => {
        if (closed || !mod.hover) return
        off = mod.hover(el, api) ?? undefined
      })
      .catch((e: unknown) => console.warn('ホバー表示を描けない', e))
  })
  onCleanup(() => {
    closed = true
    try {
      off?.()
    } catch (e) {
      console.warn('ホバー表示を閉じられない', e)
    }
  })
  return <span ref={el} class={styles.root} data-ready />
}
