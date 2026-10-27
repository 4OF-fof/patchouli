import { type JSX, Show, createSignal, onCleanup, splitProps } from 'solid-js'
import { PinToggle } from '../../controls/PinToggle/PinToggle'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './ItemCard.module.css'

export interface ItemCardProps extends Omit<ThumbProps, 'title' | 'class'> {
  name: string
  why?: string
  showName?: boolean
  ratio?: number
  pinned?: boolean
  onPin?: () => void
  onClick?: () => void
  preview?: () => JSX.Element
}

/** カーソルが通り過ぎただけのカードでは、重ねるものを作らない。 */
const HOVER_DELAY = 200

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
