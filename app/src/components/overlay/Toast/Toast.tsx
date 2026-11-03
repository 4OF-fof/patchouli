import { onCleanup, onMount, type JSX } from 'solid-js'
import styles from './Toast.module.css'
import { Icon } from '../../base/Icon/Icon'
import { coverPage } from '../../media/WebPage/layer'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

const AUTO_CLOSE_MS = 4000

export interface ToastProps {
  message: JSX.Element
  /** 色とアイコンを決める。既定は info。 */
  level?: ToastLevel
  actionLabel?: string
  onAction?: () => void
  onClose?: () => void
  /** 付けると、✕ の代わりにこの文字のボタンで閉じる。 */
  closeLabel?: string
  /** 4 秒で onClose を呼ぶ。マウスを乗せているあいだと、中にフォーカスがあるあいだは数えない。 */
  autoClose?: boolean
}

export function Toast(props: ToastProps) {
  const level = () => props.level ?? 'info'
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => clearTimeout(timer)
  const start = () => {
    stop()
    if (props.autoClose && props.onClose) timer = setTimeout(() => props.onClose?.(), AUTO_CLOSE_MS)
  }
  onMount(start)
  onCleanup(stop)
  return (
    <div
      ref={coverPage}
      class={`${styles.root} ${styles[level()]}`}
      role={level() === 'error' || level() === 'warning' ? 'alert' : 'status'}
      onPointerEnter={stop}
      onPointerLeave={start}
      onFocusIn={stop}
      onFocusOut={start}
    >
      <Icon name={level()} size={16} class={styles.icon} />
      <span class={styles.msg}>{props.message}</span>
      {props.actionLabel && (
        <button type="button" class={styles.act} onClick={() => props.onAction?.()}>
          {props.actionLabel}
        </button>
      )}
      {props.onClose &&
        (props.closeLabel ? (
          <button type="button" class={styles.quiet} onClick={() => props.onClose?.()}>
            {props.closeLabel}
          </button>
        ) : (
          <button type="button" class={styles.x} aria-label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" size={14} />
          </button>
        ))}
    </div>
  )
}
