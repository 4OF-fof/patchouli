import { For, createSignal } from 'solid-js'
import type { RemoteAsk, RemotePermission } from '../../../backend/types'
import { REMOTE_PERMISSIONS } from '../../../model/remote'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { Checkbox } from '../../controls/Checkbox/Checkbox'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './RemoteAskDialog.module.css'

export interface RemoteAskDialogProps {
  ask: RemoteAsk
  /** permissions が undefined なら拒否。 */
  onAnswer: (permissions: RemotePermission[] | undefined) => void
}

/** 初めてつないできた CLI・拡張機能・アプリに、渡す権限を選んで許可する。 */
export function RemoteAskDialog(props: RemoteAskDialogProps) {
  const asked = () => REMOTE_PERMISSIONS.filter((p) => props.ask.permissions.includes(p.id))
  const [on, setOn] = createSignal(new Set(props.ask.permissions))
  const toggle = (id: RemotePermission, checked: boolean) => {
    const next = new Set(on())
    if (checked) next.add(id)
    else next.delete(id)
    setOn(next)
  }
  const allow = () => props.onAnswer(REMOTE_PERMISSIONS.filter((p) => on().has(p.id)).map((p) => p.id))
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
      <p>ライブラリを操作するための接続を求めています。許可する権限を選択してください。</p>
      <ul class={styles.list}>
        <For each={asked()}>
          {(p) => (
            <li>
              <label>
                <Checkbox checked={on().has(p.id)} onChange={(e) => toggle(p.id, e.currentTarget.checked)} />
                {p.label}
              </label>
            </li>
          )}
        </For>
      </ul>
      <p class={styles.note}>許可した内容は、設定の「コネクタ」で変更できます。</p>
    </ConfirmDialog>
  )
}
