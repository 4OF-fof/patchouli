import { onCleanup, onMount } from 'solid-js'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import styles from './DeleteDialog.module.css'

export interface DeleteDialogProps {
  name: string
  note?: boolean
  onDelete?: () => void
  onClose?: () => void
}

export function DeleteDialog(props: DeleteDialogProps) {
  let el!: HTMLDivElement
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      props.onClose?.()
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      props.onDelete?.()
    }
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey, true)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey, true))
  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="alertdialog" aria-label="削除の確認" tabIndex={-1} ref={el}>
        <h2>「{props.name}」を削除しますか？</h2>
        <p>{props.note ? 'ノートをごみ箱に移動します。' : 'ファイルとメタ情報をごみ箱に移動します。'}</p>
        <footer>
          <Button variant="ghost" onClick={() => props.onClose?.()}>
            キャンセル <Kbd>Esc</Kbd>
          </Button>
          <Button variant="danger" onClick={() => props.onDelete?.()}>
            削除 <Kbd>Enter</Kbd>
          </Button>
        </footer>
      </div>
    </div>
  )
}
