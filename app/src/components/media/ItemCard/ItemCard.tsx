import { type JSX, Show, createSignal, onCleanup, splitProps } from 'solid-js'
import { PinToggle } from '../../controls/PinToggle/PinToggle'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './ItemCard.module.css'

export interface ItemCardProps extends Omit<ThumbProps, 'title' | 'class'> {
  name: string
  /** 名前の下の一言（例「つながり 3 · 2 日前」）。JustifiedRow の中では出さない。 */
  why?: string
  /** false で名前を隠す（ホーム）。隠しても title と読み上げには名前が入る。 */
  showName?: boolean
  /** 縦横比（幅 / 高さ）。JustifiedRow の中で幅を決める。 */
  ratio?: number
  /** ピン留めしている。 */
  pinned?: boolean
  /** 渡すと右上にピンを重ねる。ピンはホバーで出し、留めていると出たままにする。 */
  onPin?: () => void
  onClick?: () => void
  /** カーソルを合わせているあいだ、サムネイルの上に重ねるもの（動画の再生など）。 */
  preview?: () => JSX.Element
}

/** カーソルが通り過ぎただけのカードでは、重ねるものを作らない。 */
const HOVER_DELAY = 200

/** 素材やノートを一つ表すカード。押すと開く。 */
export function ItemCard(props: ItemCardProps) {
  const [local, thumb] = splitProps(props, [
    'name',
    'why',
    'showName',
    'ratio',
    'pinned',
    'onPin',
    'onClick',
    'preview',
  ])
  const showName = () => local.showName ?? true
  const [hovered, setHovered] = createSignal(false)
  let timer = 0
  const enter = () => {
    clearTimeout(timer)
    if (local.preview) timer = window.setTimeout(() => setHovered(true), HOVER_DELAY)
  }
  const leave = () => {
    clearTimeout(timer)
    setHovered(false)
  }
  onCleanup(() => clearTimeout(timer))
  const card = () => (
    <button
      type="button"
      class={styles.root}
      title={showName() ? undefined : local.name}
      aria-label={showName() ? undefined : local.name}
      style={{ '--ar': local.ratio }}
      onClick={() => local.onClick?.()}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      <span class={styles.thumb}>
        <Thumb {...thumb} title={local.name} />
        <Show when={hovered() && local.preview}>{(p) => p()()}</Show>
      </span>
      {showName() && <span class={styles.nm}>{local.name}</span>}
      {local.why && <span class={styles.why}>{local.why}</span>}
    </button>
  )
  return (
    <Show when={local.onPin} fallback={card()}>
      <div class={styles.wrap} style={{ '--ar': local.ratio }}>
        {card()}
        <PinToggle class={styles.pin} look="float" reveal pressed={local.pinned} onClick={() => local.onPin?.()} />
      </div>
    </Show>
  )
}
