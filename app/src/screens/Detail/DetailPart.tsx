import type { JSX } from 'solid-js'
import styles from './DetailPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface DetailPartProps {
  label: JSX.Element
  editing?: boolean
  class?: string
  children?: JSX.Element
  onUp?: () => void
  onDown?: () => void
  onRemove?: () => void
}

export function DetailPart(props: DetailPartProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} data-editing={props.editing}>
      {props.editing && (
        <span class={styles.ctl}>
          <button type="button" aria-label="上へ移動" disabled={!props.onUp} onClick={() => props.onUp?.()}>
            <Icon name="up" size={14} />
          </button>
          <button type="button" aria-label="下へ移動" disabled={!props.onDown} onClick={() => props.onDown?.()}>
            <Icon name="down" size={14} />
          </button>
          <button type="button" class={styles.del} aria-label="削除" onClick={() => props.onRemove?.()}>
            <Icon name="close" size={14} />
          </button>
        </span>
      )}
      <span class={styles.k}>{props.label}</span>
      {props.children}
    </div>
  )
}
