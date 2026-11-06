import { For, Show } from 'solid-js'
import type { RemoteActions, RemoteClient, RemotePermission, RemoteStatus } from '../../../backend/types'
import { REMOTE_PERMISSIONS } from '../../../model/remote'
import { Icon } from '../../base/Icon/Icon'
import { Button } from '../../controls/Button/Button'
import { Checkbox } from '../../controls/Checkbox/Checkbox'
import { TextList } from '../../controls/TextList/TextList'
import styles from './RemoteSettings.module.css'

export interface RemoteSettingsProps {
  status: RemoteStatus
  actions: RemoteActions
  busy: boolean
  /** 失敗したら、その文を見せる。 */
  run: (label: string, job: () => Promise<unknown>) => Promise<void>
  /** 変えたあとに状態を読み直す。 */
  onChanged: () => Promise<void>
}

const CLI = 'cli'

const change = (p: RemoteSettingsProps, label: string, job: () => Promise<unknown>) =>
  p.run(label, async () => {
    await job()
    await p.onChanged()
  })

export function CliPathSetting(props: RemoteSettingsProps) {
  const s = () => props.status
  return (
    <div class={styles.row}>
      <div class={styles.what}>
        <span class={styles.name}>PATH に登録</span>
        <span class={styles.help}>端末から patchouli コマンドで呼び出せるようにします</span>
        <span class={styles.path} data-tip={s().path ? s().command : s().cli}>
          {s().path ? s().command : (s().cli ?? 'CLI（patchouli-cli）が見つかりません')}
        </span>
      </div>
      <Button
        size="sm"
        disabled={props.busy || (!s().path && !s().cli)}
        onClick={() =>
          void change(props, s().path ? 'PATH から解除しています' : 'PATH に登録しています', () =>
            props.actions.setPath(!s().path),
          )
        }
      >
        {s().path ? '解除' : '登録'}
      </Button>
    </div>
  )
}

export function SkillSetting(props: RemoteSettingsProps) {
  const pick = async () => {
    const dir = await props.actions.pickSkillDir()
    if (dir) await change(props, 'skill をインストールしています', () => props.actions.installSkill(dir))
  }
  return (
    <div class={styles.block}>
      <div class={styles.blockHead}>
        <div class={styles.what}>
          <span class={styles.name}>skill</span>
          <span class={styles.help}>AI エージェントが CLI を使うための SKILL.md をインストールします</span>
        </div>
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => void pick()}>
          <Icon name="plus" size={14} withText />
          フォルダを選択してインストール
        </Button>
      </div>
      <For each={props.status.skills}>
        {(p) => (
          <div class={styles.place}>
            <span class={styles.path} data-tip={p.dir}>
              {p.dir}
            </span>
            <span class={styles.state}>{p.installed ? 'インストール済み' : '未導入'}</span>
            <Show
              when={p.installed}
              fallback={
                <Button
                  size="sm"
                  disabled={props.busy}
                  onClick={() =>
                    void change(props, 'skill をインストールしています', () => props.actions.installSkill(p.dir))
                  }
                >
                  インストール
                </Button>
              }
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={props.busy}
                onClick={() => void change(props, 'skill を更新しています', () => props.actions.installSkill(p.dir))}
              >
                更新
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.busy}
                onClick={() => void change(props, 'skill を削除しています', () => props.actions.removeSkill(p.dir))}
              >
                削除
              </Button>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

const dateOf = (ms: number) => (ms ? new Date(ms).toLocaleString() : '')

function ClientRow(props: RemoteSettingsProps & { client: RemoteClient; title?: string }) {
  const c = () => props.client
  const toggle = (id: RemotePermission, on: boolean) => {
    const next = REMOTE_PERMISSIONS.map((p) => p.id).filter((p) => (p === id ? on : c().permissions.includes(p)))
    void change(props, '権限を変更しています', () => props.actions.setClient(c().key, true, next))
  }
  return (
    <div class={styles.client}>
      <div class={styles.clientHead}>
        <div class={styles.what}>
          <span class={styles.name}>{props.title ?? c().name}</span>
          <span class={styles.path}>{dateOf(c().last) && `最終接続：${dateOf(c().last)}`}</span>
        </div>
        <span class={styles.state} data-off={!c().allowed}>
          {c().allowed ? '許可' : '拒否'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.busy}
          onClick={() =>
            void change(props, c().allowed ? '接続を拒否しています' : '接続を許可しています', () =>
              props.actions.setClient(c().key, !c().allowed, c().permissions),
            )
          }
        >
          {c().allowed ? '拒否' : '許可'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.busy}
          onClick={() => void change(props, '接続先を削除しています', () => props.actions.forgetClient(c().key))}
        >
          削除
        </Button>
      </div>
      <Show when={c().allowed}>
        <ul class={styles.perms}>
          <For each={REMOTE_PERMISSIONS}>
            {(p) => (
              <li>
                <label>
                  <Checkbox
                    checked={c().permissions.includes(p.id)}
                    disabled={props.busy}
                    onChange={(e) => toggle(p.id, e.currentTarget.checked)}
                  />
                  {p.label}
                </label>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export function CliAccessSetting(props: RemoteSettingsProps) {
  const cli = () => props.status.clients.find((c) => c.key === CLI)
  return (
    <Show
      when={cli()}
      fallback={
        <div class={styles.row}>
          <div class={styles.what}>
            <span class={styles.name}>接続の許可</span>
            <span class={styles.help}>初めて接続したときに、許可するかを確認します</span>
          </div>
        </div>
      }
    >
      {(c) => <ClientRow {...props} client={c()} title="接続の許可" />}
    </Show>
  )
}

const CHROMIUM_ID = /^[a-p]{32}$/
const EXTENSION_ID = /^[A-Za-z0-9@.\-_{}]{1,200}$/

export function ExtensionSetting(props: RemoteSettingsProps) {
  const update = (next: string[]) => {
    const now = props.status.extensions
    const added = next.filter((id) => !now.includes(id))
    const removed = now.filter((id) => !next.includes(id))
    void change(props, added.length ? '拡張機能を登録しています' : '拡張機能を削除しています', async () => {
      for (const id of removed) await props.actions.removeExtension(id)
      for (const id of added) await props.actions.addExtension(id)
    })
  }
  return (
    <div class={styles.block}>
      <div class={styles.what}>
        <span class={styles.name}>ブラウザの拡張機能</span>
        <span class={styles.help}>
          Native Messaging で接続できる拡張機能の ID を登録します。ホスト名は {props.status.host} です
        </span>
      </div>
      <TextList
        class={styles.list}
        name="拡張機能の ID"
        values={props.status.extensions}
        reject={(v) => !(CHROMIUM_ID.test(v) || EXTENSION_ID.test(v))}
        onChange={update}
      />
    </div>
  )
}

export function AppClientSetting(props: RemoteSettingsProps) {
  const apps = () => props.status.clients.filter((c) => c.key !== CLI)
  return (
    <div class={styles.block}>
      <div class={styles.what}>
        <span class={styles.name}>接続したアプリ</span>
        <span class={styles.help}>
          拡張機能やほかのアプリが初めて接続したときに、許可するかを確認します。削除すると、次に接続したときにもう一度確認します
        </span>
      </div>
      <For each={apps()} fallback={<p class={styles.none}>接続したアプリはまだありません</p>}>
        {(c) => <ClientRow {...props} client={c} />}
      </For>
    </div>
  )
}
