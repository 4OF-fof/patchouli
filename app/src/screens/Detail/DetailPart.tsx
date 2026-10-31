import { type JSX, Show } from 'solid-js'
import styles from './DetailPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'
import { dragPart, nudgePart } from './partDrag'

export interface DetailPartProps {
  label: JSX.Element
  editing?: boolean
  class?: string
  children?: JSX.Element
  /** by は動かす枚数。上へは負の数 */
  onMove?: (by: number) => void
  onRemove?: () => void
}

export function DetailPart(props: DetailPartProps) {
  const move = (by: number) => props.onMove?.(by)
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} data-editing={props.editing} data-part>
      <Show when={props.editing} fallback={<span class={styles.k}>{props.label}</span>}>
        <div class={styles.head} onPointerDown={(e) => !e.target.closest(`.${styles.del}`) && dragPart(e, move)}>
          <button
            type="button"
            class={styles.grip}
            data-grip
            aria-label="並べ替え"
            data-tip="ドラッグで並べ替え"
            onKeyDown={(e) => nudgePart(e, move)}
          >
            <Icon name="grip" size={14} />
          </button>
          <span class={styles.k}>{props.label}</span>
          <button type="button" class={styles.del} aria-label="削除" onClick={() => props.onRemove?.()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </Show>
      {props.children}
    </div>
  )
}
