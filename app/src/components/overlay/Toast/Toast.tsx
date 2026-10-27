import type { JSX } from 'solid-js'
import styles from './Toast.module.css'
import { Icon } from '../../base/Icon/Icon'

export interface ToastProps {
  message: JSX.Element
  actionLabel?: string
  onAction?: () => void
  onClose?: () => void
}

export function Toast(props: ToastProps) {
  return (
    <div class={styles.root} role="status">
      <span class={styles.msg}>{props.message}</span>
      {(props.actionLabel || props.onClose) && <span class={styles.sep} />}
      {props.actionLabel && (
        <button type="button" class={styles.act} onClick={() => props.onAction?.()}>
          {props.actionLabel}
        </button>
      )}
      {props.onClose && (
        <button type="button" class={styles.x} aria-label="閉じる" onClick={() => props.onClose?.()}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}
