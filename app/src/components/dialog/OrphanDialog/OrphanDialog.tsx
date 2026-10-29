import { For, Show, createSignal } from 'solid-js'
import type { Orphan } from '../../../backend/types'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { Select } from '../../controls/Select/Select'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './OrphanDialog.module.css'

export interface OrphanDialogProps {
  orphans: Orphan[]
  onRelink?: (meta: string, to: string) => void
  onDiscard?: (meta: string) => void
  onClose?: () => void
}

function Row(props: { orphan: Orphan; onRelink?: (to: string) => void; onDiscard?: () => void }) {
  const o = () => props.orphan
  const [to, setTo] = createSignal(o().candidates.length === 1 ? (o().candidates[0] ?? '') : '')
  const where = () => (o().project ? 'プロジェクト' : o().folder ? `素材 · ${o().folder}` : '素材')
  return (
    <li class={styles.row}>
      <div class={styles.name}>
        <b>{o().name}</b>
        <small>{where()}</small>
      </div>
      <div class={styles.ctl}>
        <Show when={o().candidates.length} fallback={<span class={styles.none}>再リンクできる項目がありません</span>}>
          <Select
            class={styles.pick}
            aria-label={`「${o().name}」の再リンク先`}
            value={to()}
            options={[{ value: '', label: '再リンク先を選択' }, ...o().candidates.map((c) => ({ value: c, label: c }))]}
            onChange={setTo}
          />
          <Button size="sm" disabled={!to()} onClick={() => props.onRelink?.(to())}>
            再リンク
          </Button>
        </Show>
        <Button size="sm" variant="ghost" onClick={() => props.onDiscard?.()}>
          削除
        </Button>
      </div>
    </li>
  )
}

/** 本体が見つからない .meta を、名前を変えた先に再リンクするか、削除してもらう。 */
export function OrphanDialog(props: OrphanDialogProps) {
  return (
    <ConfirmDialog
      label="本体が見つからないメタ情報"
      title={`本体が見つからないメタ情報が ${props.orphans.length} 件あります`}
      class={styles.root}
      onClose={props.onClose}
      footer={
        <Button variant="ghost" onClick={() => props.onClose?.()}>
          保留 <Kbd>Esc</Kbd>
        </Button>
      }
    >
      <p>
        名前を変更した素材やプロジェクトに再リンクするか、削除します。削除したメタ情報は、プロジェクトの概要とあわせてごみ箱に移動します。
      </p>
      <ul class={styles.list}>
        <For each={props.orphans}>
          {(o) => (
            <Row
              orphan={o}
              onRelink={(to) => props.onRelink?.(o.meta, to)}
              onDiscard={() => props.onDiscard?.(o.meta)}
            />
          )}
        </For>
      </ul>
    </ConfirmDialog>
  )
}
