import type { JSX } from 'solid-js'
import styles from './Toast.module.css'

export interface ToastProps {
  message: JSX.Element
  /** 例「見る」「元に戻す」。 */
  actionLabel?: string
  onAction?: () => void
  /** 渡すと ✕ を出す。 */
  onClose?: () => void
}

/** 画面の上の中央に出す知らせ。 */
export function Toast(props: ToastProps) {
  return (
    <div class={styles.root} role="status">
      <span>{props.message}</span>
      {props.actionLabel && (
        <button type="button" class={styles.act} onClick={() => props.onAction?.()}>
          {props.actionLabel}
        </button>
      )}
      {props.onClose && (
        <button type="button" class={styles.x} aria-label="閉じる" onClick={() => props.onClose?.()}>
          ✕
        </button>
      )}
    </div>
  )
}
