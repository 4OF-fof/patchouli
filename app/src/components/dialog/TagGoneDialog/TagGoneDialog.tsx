import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'

export interface TagGoneDialogProps {
  tag: string
  onDelete?: () => void
  onClose?: () => void
}

/** 概要のあるタグが、どの項目にも付かなくなったとき。 */
export function TagGoneDialog(props: TagGoneDialogProps) {
  return (
    <ConfirmDialog
      label="タグの概要の削除"
      title={`「# ${props.tag}」が付いた項目がなくなりました`}
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
      <p>このタグの概要を削除しますか？ 概要はごみ箱に移動します。</p>
    </ConfirmDialog>
  )
}
