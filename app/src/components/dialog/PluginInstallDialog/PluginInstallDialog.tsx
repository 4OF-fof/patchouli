import { For, Show } from 'solid-js'
import { FULL_ACCESS, PERMISSION, sourceLabel } from '../../../plugins/labels'
import type { Prepared } from '../../../plugins/types'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './PluginInstallDialog.module.css'

export interface PluginInstallDialogProps {
  prepared: Prepared
  busy?: boolean
  onInstall?: () => void
  onClose?: () => void
}

/** 取得したプラグインを、権限を見せてからインストールする。 */
export function PluginInstallDialog(props: PluginInstallDialogProps) {
  const p = () => props.prepared.plugin
  const added = () => props.prepared.added
  const rows = () => [
    ...(added().full ? [{ ...FULL_ACCESS, full: true }] : []),
    ...added().permissions.map((x) => ({ label: PERMISSION[x] ?? x, text: '', full: false })),
    ...(added().commands.length ? [{ label: '外部ツールの実行', text: added().commands.join(', '), full: false }] : []),
    ...(added().fetch.length ? [{ label: '接続先', text: added().fetch.join(', '), full: false }] : []),
  ]
  const verb = () => (props.prepared.first ? 'インストール' : '更新')
  const install = () => !props.busy && props.onInstall?.()
  return (
    <ConfirmDialog
      label={`プラグインの${verb()}`}
      title={
        props.prepared.first
          ? `「${p().name}」をインストールしますか？`
          : `「${p().name}」を ${p().version} に更新しますか？`
      }
      class={styles.root}
      onClose={props.onClose}
      onEnter={install}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onClose?.()}>
            キャンセル <Kbd>Esc</Kbd>
          </Button>
          <Button variant="primary" disabled={props.busy} onClick={install}>
            {verb()} <Kbd>Enter</Kbd>
          </Button>
        </>
      }
    >
      <dl class={styles.facts}>
        <dt>ID</dt>
        <dd>{p().id}</dd>
        <dt>バージョン</dt>
        <dd>{p().version}</dd>
        <Show when={p().source}>
          {(s) => (
            <>
              <dt>取得先</dt>
              <dd>
                {sourceLabel(s())}
                <Show when={p().tag}>{(t) => `（${t()}）`}</Show>
              </dd>
            </>
          )}
        </Show>
      </dl>
      <Show when={p().description}>
        <p>{p().description}</p>
      </Show>
      <Show when={rows().length} fallback={<p class={styles.none}>特別な権限は使用しません</p>}>
        <h3>{props.prepared.first ? '使用する権限' : '新しく追加される権限'}</h3>
        <ul class={styles.risks}>
          <For each={rows()}>
            {(r) => (
              <li data-full={r.full}>
                <span>{r.label}</span>
                <Show when={r.text}>
                  <small>{r.text}</small>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </ConfirmDialog>
  )
}
