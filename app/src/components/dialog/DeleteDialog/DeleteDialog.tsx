import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'

export interface DeleteDialogProps {
  name: string
  note?: boolean
  onDelete?: () => void
  onClose?: () => void
}

export function DeleteDialog(props: DeleteDialogProps) {
  return (
    <ConfirmDialog
      label="削除の確認"
      title={`「${props.name}」を削除しますか？`}
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
      <p>{props.note ? 'ノートをごみ箱に移動します。' : 'ファイルとメタ情報をごみ箱に移動します。'}</p>
    </ConfirmDialog>
  )
}
