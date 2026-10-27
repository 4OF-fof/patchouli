import { type JSX, Show, createContext, createSignal, onCleanup, onMount, useContext } from 'solid-js'
import type { Item } from '../../../model/library'
import { useFormats } from '../../../plugins/formats'
import type { Fit, UiRef } from '../../../plugins/types'
import { type UiApi, loadUi } from '../../../plugins/ui'
import { clock } from '../PlayerBar/clock'
import styles from './HoverPreview.module.css'

/** 組み込み UI の hover を描くのに要るもの。渡さなければ、本体が見せるもの（動画など）だけにする。 */
export interface HoverHost {
  ui?: (item: Item, ui: UiRef) => { url: string; api: UiApi }
}

const Host = createContext<HoverHost>({})

export const HoverHostProvider = Host.Provider

/** 素材にカーソルを合わせたときに、サムネイルの上に重ねる表示を返す関数。重ねるものがなければ undefined を返す。 */
export function useHoverPreview() {
  const formats = useFormats()
  const host = useContext(Host)
  return (it: Item): (() => JSX.Element) | undefined => {
    const f = it.note ? undefined : formats.get(it.ext)
    const make = host.ui
    const ui = f?.uiHover
    if (ui && make)
      return () => {
        const p = make(it, ui)
        return <PluginHover url={p.url} api={p.api} />
      }
    const src = it.src
    if (f?.hover === 'video' && src) return () => <VideoHover src={src} fit={it.fit} />
    return undefined
  }
}

/** 元のファイルを音を消して頭から再生する。再生が始まるまでは透かして、下のサムネイルを見せておく。 */
export function VideoHover(props: { src: string; fit?: Fit }) {
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
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 音を消した見本の再生 */}
      <video
        ref={video}
        class={styles.video}
        data-fit={props.fit ?? 'center'}
        src={props.src}
        muted
        autoplay
        loop
        playsinline
        onPlaying={() => setReady(true)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onDurationChange={(e) => setLength(e.currentTarget.duration)}
      />
      <Show when={ready() && length() > 0}>
        <span class={styles.time}>
          {clock(at())} / {clock(length())}
        </span>
        <span class={styles.mute}>ミュート</span>
        <span class={styles.track}>
          <span class={styles.done} style={{ width: `${Math.min(100, (at() / length()) * 100)}%` }} />
        </span>
      </Show>
    </span>
  )
}

/** 組み込み UI の hover。失敗しても、下のサムネイルが見えたままになるだけにする。 */
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
