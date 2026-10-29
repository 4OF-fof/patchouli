import { Show, createSignal } from 'solid-js'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './TagMergeDialog.module.css'

export interface TagMergeDialogProps {
  from: string
  to: string
  /** 名前を変えるタグが付いた項目の数 */
  count: number
  /** 両方のタグに概要があり、どちらを残すか選んでもらうとき */
  covers?: boolean
  onMerge?: (keepFrom: boolean) => void
  onRename?: (to: string) => void
  onClose?: () => void
}

/** タグの名前を、すでにあるタグの名前に変えようとしたとき。 */
export function TagMergeDialog(props: TagMergeDialogProps) {
  const [keepFrom, setKeepFrom] = createSignal(false)
  const [other, setOther] = createSignal(props.to)
  const renamable = () => !!other().trim() && other().trim() !== props.to
  const rename = () => renamable() && props.onRename?.(other().trim())
  return (
    <ConfirmDialog
      label="タグ名の重複"
      title={`「# ${props.to}」はすでに存在します`}
      onClose={props.onClose}
      onEnter={() => props.onMerge?.(keepFrom())}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onClose?.()}>
            キャンセル <Kbd>Esc</Kbd>
          </Button>
          <Button variant="primary" onClick={() => props.onMerge?.(keepFrom())}>
            マージ <Kbd>Enter</Kbd>
          </Button>
        </>
      }
    >
      <p>{`「# ${props.from}」が付いた ${props.count} 件を「# ${props.to}」にマージするか、別の名前に変更します。`}</p>
      <Show when={props.covers}>
        <fieldset class={styles.keep}>
          <legend>マージ後に残す概要</legend>
          <label>
            <input type="radio" name="keep" checked={!keepFrom()} onChange={() => setKeepFrom(false)} />
            {`「# ${props.to}」の概要`}
          </label>
          <label>
            <input type="radio" name="keep" checked={keepFrom()} onChange={() => setKeepFrom(true)} />
            {`「# ${props.from}」の概要`}
          </label>
          <small>残さない概要はごみ箱に移動します。</small>
        </fieldset>
      </Show>
      <div class={styles.rename}>
        <input
          type="text"
          aria-label="別のタグ名"
          value={other()}
          onInput={(e) => setOther(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && rename()}
        />
        <Button disabled={!renamable()} onClick={rename}>
          名前を変更
        </Button>
      </div>
    </ConfirmDialog>
  )
}
