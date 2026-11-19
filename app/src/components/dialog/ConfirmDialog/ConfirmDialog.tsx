import type { JSX } from 'solid-js'
import { DialogFrame } from '../DialogFrame/DialogFrame'
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
  const onKey = (e: KeyboardEvent) => {
    if (
      e.key === 'Enter' &&
      !e.isComposing &&
      !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) &&
      props.onEnter
    ) {
      e.preventDefault()
      props.onEnter()
    }
  }
  return (
    <DialogFrame
      label={props.label}
      role="alertdialog"
      overlayClass={styles.ov}
      class={`${styles.root} ${props.class ?? ''}`}
      onClose={props.onClose}
      onKeyDown={onKey}
    >
      <h2>{props.title}</h2>
      {props.children}
      <footer>{props.footer}</footer>
    </DialogFrame>
  )
}
