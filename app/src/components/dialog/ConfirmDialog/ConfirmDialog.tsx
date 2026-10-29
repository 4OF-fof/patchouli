import { type JSX, onCleanup, onMount } from 'solid-js'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  label: string
  title: JSX.Element
  children?: JSX.Element
  footer: JSX.Element
  class?: string
  onClose?: () => void
  /** 入力欄やボタンの上でないときに Enter で選ぶ操作。 */
  onEnter?: () => void
}

/** 確認や選択を求める小さなダイアログ。Esc と枠の外のクリックで閉じる。 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  let el!: HTMLDivElement
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      props.onClose?.()
    } else if (
      e.key === 'Enter' &&
      !e.isComposing &&
      !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) &&
      props.onEnter
    ) {
      e.preventDefault()
      props.onEnter()
    }
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey, true)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey, true))
  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div
        class={`${styles.root} ${props.class ?? ''}`}
        role="alertdialog"
        aria-label={props.label}
        tabIndex={-1}
        ref={el}
      >
        <h2>{props.title}</h2>
        {props.children}
        <footer>{props.footer}</footer>
      </div>
    </div>
  )
}
