import { For } from 'solid-js'
import type { RemoteAsk, RemotePermission } from '../../../backend/types'
import { REMOTE_PERMISSIONS } from '../../../model/remote'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './RemoteAskDialog.module.css'

export interface RemoteAskDialogProps {
  ask: RemoteAsk
  /** permissions が undefined なら拒否。 */
  onAnswer: (permissions: RemotePermission[] | undefined) => void
}

/** 初めてつないできた CLI・拡張機能・アプリに、求められた権限を示して許可するかを尋ねる。 */
export function RemoteAskDialog(props: RemoteAskDialogProps) {
  const asked = () => REMOTE_PERMISSIONS.filter((p) => props.ask.permissions.includes(p.id))
  const allow = () => props.onAnswer(asked().map((p) => p.id))
  return (
    <ConfirmDialog
      label="接続の許可"
      title={`「${props.ask.name}」からの接続を許可しますか？`}
      class={styles.root}
      onClose={() => props.onAnswer(undefined)}
      onEnter={allow}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onAnswer(undefined)}>
            拒否 <Kbd>Esc</Kbd>
          </Button>
          <Button variant="primary" onClick={allow}>
            許可 <Kbd>Enter</Kbd>
          </Button>
        </>
      }
    >
      <p>ライブラリを操作するための接続を求めています。許可すると次の権限を付与します。</p>
      <ul class={styles.list}>
        <For each={asked()}>{(p) => <li>{p.label}</li>}</For>
      </ul>
      <p class={styles.note}>許可した内容は、設定の「コネクタ」で変更できます。</p>
    </ConfirmDialog>
  )
}
