import { type JSX, Show, createSignal, onCleanup, splitProps } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { PinToggle } from '../../controls/PinToggle/PinToggle'
import { useSelectArea } from '../Selection/Selection'
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
  const area = useSelectArea()
  const selectable = () => !!area && !!thumb.id
  const on = () => !!area && !!thumb.id && area.sel.has(thumb.id)
  const open = () => local.onClick?.()
  const onClick = (e: MouseEvent) => (area && thumb.id ? area.click(e, thumb.id, open) : open())
  const card = () => (
    <button
      type="button"
      class={styles.root}
      aria-label={showName() ? undefined : local.name}
      style={{ '--ar': local.ratio }}
      onClick={onClick}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      <span class={styles.thumb}>
        <Thumb {...thumb} title={local.name} selected={thumb.selected || on()} />
        <Show when={hovered() && local.preview}>{(p) => p()()}</Show>
      </span>
      {showName() && <span class={styles.nm}>{local.name}</span>}
      {local.why && <span class={styles.why}>{local.why}</span>}
    </button>
  )
  return (
    <Show when={local.onPin || selectable()} fallback={card()}>
      <div class={styles.wrap} style={{ '--ar': local.ratio }} data-select={selectable() ? thumb.id : undefined}>
        {card()}
        <Show when={local.onPin}>
          <PinToggle class={styles.pin} look="float" reveal pressed={local.pinned} onClick={() => local.onPin?.()} />
        </Show>
        <Show when={area && thumb.id}>
          {(id) => (
            <button
              type="button"
              class={styles.mark}
              role="checkbox"
              aria-checked={on()}
              aria-label={`「${local.name}」を選ぶ`}
              onClick={(e) => {
                e.stopPropagation()
                area?.click(e, id(), () => area.sel.toggle(id()))
              }}
            >
              <Icon name="check" size={12} />
            </button>
          )}
        </Show>
      </div>
    </Show>
  )
}
