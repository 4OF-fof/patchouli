import { For, Show } from 'solid-js'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './DeleteDialog.module.css'

/** 名前を並べる数。残りは件数だけ出す。 */
const LISTED = 5

export interface DeleteDialogProps {
  items: { name: string; note?: boolean }[]
  onDelete?: () => void
  onClose?: () => void
}

export function DeleteDialog(props: DeleteDialogProps) {
  const n = () => props.items.length
  const notes = () => props.items.filter((i) => i.note).length
  const what = () =>
    notes() === n()
      ? 'ノートをごみ箱に移動します。'
      : notes()
        ? 'ノートと、素材のファイルとメタ情報をごみ箱に移動します。'
        : 'ファイルとメタ情報をごみ箱に移動します。'
  return (
    <ConfirmDialog
      label="削除の確認"
      title={n() === 1 ? `「${props.items[0]?.name}」を削除しますか？` : `${n()} 件を削除しますか？`}
      onClose={props.onClose}
      onEnter={() => props.onDelete?.()}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onClose?.()}>
            キャンセル <Kbd>Esc</Kbd>
          </Button>
          <Button variant="danger" onClick={() => props.onDelete?.()}>
            削除 <Kbd>Enter</Kbd>
          </Button>
        </>
      }
    >
      <p>{what()}</p>
      <Show when={n() > 1}>
        <ul class={styles.names}>
          <For each={props.items.slice(0, LISTED)}>{(i) => <li>{i.name}</li>}</For>
          <Show when={n() > LISTED}>
            <li class={styles.more}>ほか {n() - LISTED} 件</li>
          </Show>
        </ul>
      </Show>
    </ConfirmDialog>
  )
}
