import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  AutoTag,
  AutoTagProgress,
  CacheKind,
  CacheUsage,
  Developer,
  TagSuggest,
  UnusedPlugin,
} from '../../../backend/types'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import styles from './SettingsDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export type TabsAt = 'top' | 'left'
export type SettingsPage = 'app' | 'view' | 'ai' | 'cache' | 'developer'

export interface SettingsDialogProps {
  version: string
  /** 開いたときに出すページ。 */
  page?: SettingsPage
  tabsAt?: TabsAt
  onTabsAtChange?: (at: TabsAt) => void
  autoTag?: AutoTag
  autoTagProgress?: AutoTagProgress
  /** 有効にするときは、ダウンロードし終えるまで待つ。 */
  onAutoTagChange?: (on: boolean) => Promise<void>
  onCancelDownload?: () => Promise<void>
  onSuggestChange?: (mode: TagSuggest) => Promise<void>
  onSearchChange?: (on: boolean) => Promise<void>
  usage?: CacheUsage
  unused?: UnusedPlugin[]
  onClear?: (kind: CacheKind) => Promise<void>
  onRemoveUnused?: () => Promise<void>
  developer?: Developer
  onDeveloperChange?: (d: Developer) => Promise<void>
  onPickDevPath?: (kind: 'dir' | 'repo') => Promise<string | undefined>
  onReload?: () => void
  onClose?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const bytesLabel = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`
}

const CACHES: { kind: CacheKind; label: string }[] = [
  { kind: 'library', label: 'インデックス' },
  { kind: 'thumbs', label: 'サムネイル' },
  { kind: 'all', label: 'すべて' },
]

const SUGGEST: { value: TagSuggest; label: string; help: string }[] = [
  {
    value: 'auto',
    label: '自動で適用',
    help: '選択済みの候補をそのまま付けます。候補を選択できなかった項目は、分類の確認に表示します',
  },
  { value: 'confirm', label: '確認してから適用', help: '候補を分類の確認に表示し、承認したタグを付けます' },
  { value: 'off', label: '無効', help: 'タグの候補を作成しません' },
]

const progressLabel = (p: AutoTagProgress) => `${p.file}: ${Math.floor((p.done / p.total) * 100)}%`

const PLACES = {
  dir: { key: 'pluginDirs', label: '開発用プラグインのフォルダ', noun: 'フォルダ' },
  repo: { key: 'repos', label: 'プラグインのリポジトリ', noun: 'リポジトリ' },
} as const

export function SettingsDialog(props: SettingsDialogProps) {
  let el!: HTMLDivElement
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  /** 開発者モードを変えられなかったときに増やし、スイッチを渡された値に描き直す。 */
  const [failed, setFailed] = createSignal(0)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label)
    setError(undefined)
    try {
      await job()
    } catch (e) {
      setError(message(e))
      setFailed(failed() + 1)
    } finally {
      setBusy(undefined)
    }
  }
  const [switching, setSwitching] = createSignal(false)
  const changeAutoTag = async (change: (on: boolean) => Promise<void>, on: boolean) => {
    setSwitching(true)
    setError(undefined)
    try {
      await change(on)
    } catch (e) {
      setError(message(e))
      setFailed(failed() + 1)
    } finally {
      setSwitching(false)
    }
  }
  const downloading = () => switching() || !!props.autoTag?.downloading

  const unusedBytes = () => (props.unused ?? []).reduce((n, p) => n + p.bytes, 0)
  const sizeOf = (u: CacheUsage, kind: CacheKind) =>
    kind === 'library' ? u.library : kind === 'thumbs' ? u.thumbs : u.library + u.thumbs + unusedBytes()

  const addPath = async (d: Developer, kind: 'dir' | 'repo') => {
    const { key, noun } = PLACES[kind]
    setError(undefined)
    try {
      const p = await props.onPickDevPath!(kind)
      if (p && !d[key].includes(p))
        await run(`${noun}を追加しています`, () => props.onDeveloperChange!({ ...d, [key]: [...d[key], p] }))
    } catch (e) {
      setError(message(e))
    }
  }
  const removePath = (d: Developer, kind: 'dir' | 'repo', p: string) => {
    const { key, noun } = PLACES[kind]
    void run(`${noun}を削除しています`, () => props.onDeveloperChange!({ ...d, [key]: d[key].filter((x) => x !== p) }))
  }

  const pages = () =>
    [
      { id: 'app' as const, label: 'アプリ', on: true },
      { id: 'view' as const, label: '表示', on: !!props.onTabsAtChange },
      { id: 'ai' as const, label: 'AI 機能', on: !!props.onAutoTagChange },
      { id: 'cache' as const, label: 'キャッシュ', on: !!(props.onClear || props.onRemoveUnused) },
      { id: 'developer' as const, label: '開発者モード', on: !!props.onDeveloperChange },
    ].filter((p) => p.on)
  const [picked, setPicked] = createSignal<SettingsPage>(props.page ?? 'app')
  const current = () => pages().find((p) => p.id === picked()) ?? pages()[0]

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="設定" tabIndex={-1} ref={el}>
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <nav class={styles.side}>
          <h2>設定</h2>
          <ScrollArea class={styles.list} viewClass={styles.listView}>
            <For each={pages()}>
              {(p) => (
                <button
                  type="button"
                  class={styles.item}
                  aria-current={current().id === p.id}
                  onClick={() => setPicked(p.id)}
                >
                  {p.label}
                </button>
              )}
            </For>
          </ScrollArea>
        </nav>
        <ScrollArea class={styles.main} viewClass={styles.mainView}>
          <Show when={busy() || error()}>
            <p class={styles.status} data-error={!!error()} role="status">
              {error() ?? `${busy()}…`}
            </p>
          </Show>
          <h3 class={styles.head}>{current().label}</h3>
          <Switch>
            <Match when={current().id === 'app'}>
              <div class={styles.row}>
                <b>Patchouli</b>
                <span class={styles.mono}>{props.version}</span>
              </div>
            </Match>
            <Match when={current().id === 'view' && props.onTabsAtChange}>
              {(change) => (
                <>
                  <SettingField
                    setting={{
                      key: 'tabsAt',
                      label: 'タブの位置',
                      kind: 'choice',
                      choices: [
                        { value: 'top', label: '上' },
                        { value: 'left', label: '左' },
                      ],
                      default: 'top',
                      value: props.tabsAt ?? 'top',
                      help: '左にすると、カーソルを窓の左端に寄せたときに出ます',
                    }}
                    onChange={(v) => change()(v === 'left' ? 'left' : 'top')}
                  />
                </>
              )}
            </Match>
            <Match when={current().id === 'ai' && props.onAutoTagChange}>
              {(change) => (
                <>
                  <Show when={props.autoTag} fallback={<p class={styles.loading}>読み込み中…</p>}>
                    {(a) => (
                      <>
                        <For each={[failed()]}>
                          {() => (
                            <SettingField
                              setting={{
                                key: 'autoTag',
                                label: 'AI 機能を有効化',
                                kind: 'toggle',
                                default: false,
                                value: a().enabled || downloading(),
                                help: a().installed
                                  ? '自動分類と AI 検索に使用します'
                                  : `自動分類と AI 検索に使用します。有効にすると、モデルと llama.cpp（${bytesLabel(a().need)}）をダウンロードします`,
                              }}
                              disabled={downloading()}
                              onChange={(v) => void changeAutoTag(change(), v === true)}
                            />
                          )}
                        </For>
                        <Show when={a().enabled && a().installed && !downloading()}>
                          <div class={styles.sub}>
                            <For each={[failed()]}>
                              {() => (
                                <>
                                  <Show when={props.onSuggestChange}>
                                    {(set) => (
                                      <SettingField
                                        setting={{
                                          key: 'tagSuggest',
                                          label: '自動分類',
                                          kind: 'choice',
                                          choices: SUGGEST.map(({ value, label }) => ({ value, label })),
                                          default: 'confirm',
                                          value: a().suggest,
                                          help: SUGGEST.find((s) => s.value === a().suggest)?.help,
                                        }}
                                        onChange={(v) =>
                                          void run('自動分類を切り替えています', () => set()(v as TagSuggest))
                                        }
                                      />
                                    )}
                                  </Show>
                                  <Show when={props.onSearchChange}>
                                    {(set) => (
                                      <SettingField
                                        setting={{
                                          key: 'contentSearch',
                                          label: 'AI 検索',
                                          kind: 'toggle',
                                          default: true,
                                          value: a().search,
                                          help: '検索バーで Tab を押すと、内容で検索できます',
                                        }}
                                        onChange={(v) => void run('AI 検索を切り替えています', () => set()(v === true))}
                                      />
                                    )}
                                  </Show>
                                </>
                              )}
                            </For>
                          </div>
                        </Show>
                        <Show when={downloading() && !a().installed}>
                          <div class={styles.row}>
                            <b>ダウンロード中</b>
                            <span class={styles.mono}>
                              {props.autoTagProgress ? progressLabel(props.autoTagProgress) : '…'}
                            </span>
                            <Show when={props.onCancelDownload}>
                              {(cancel) => (
                                <Button size="sm" onClick={() => void cancel()()}>
                                  キャンセル
                                </Button>
                              )}
                            </Show>
                          </div>
                        </Show>
                        <Show when={a().gpus}>
                          {(g) => (
                            <div class={styles.row}>
                              <b>実行環境</b>
                              <span class={styles.mono}>
                                {g().length ? `GPU: ${g().join('、')}` : 'CPU（GPU が見つからないため）'}
                              </span>
                            </div>
                          )}
                        </Show>
                      </>
                    )}
                  </Show>
                </>
              )}
            </Match>
            <Match when={current().id === 'cache'}>
              <Show when={props.onClear}>
                {(clear) => (
                  <For each={CACHES}>
                    {(c) => (
                      <div class={styles.row}>
                        <b>{c.label}</b>
                        <span class={styles.mono}>{props.usage ? bytesLabel(sizeOf(props.usage, c.kind)) : '…'}</span>
                        <Button
                          size="sm"
                          variant={c.kind === 'all' ? 'danger' : 'default'}
                          disabled={busy() !== undefined}
                          onClick={() => void run(`${c.label}を削除しています`, () => clear()(c.kind))}
                        >
                          削除
                        </Button>
                      </div>
                    )}
                  </For>
                )}
              </Show>
              <Show when={props.onRemoveUnused}>
                {(remove) => (
                  <div class={styles.row}>
                    <b data-tip={props.unused?.map((p) => p.name).join('、')}>未使用のプラグイン</b>
                    <span class={styles.mono}>
                      {props.unused ? `${props.unused.length} 件 | ${bytesLabel(unusedBytes())}` : '…'}
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy() !== undefined || !props.unused?.length}
                      onClick={() => void run('未使用のプラグインを削除しています', remove())}
                    >
                      削除
                    </Button>
                  </div>
                )}
              </Show>
            </Match>
            <Match when={current().id === 'developer' && props.onDeveloperChange}>
              {(change) => (
                <>
                  <Show when={props.developer} fallback={<p class={styles.loading}>読み込み中…</p>}>
                    {(d) => (
                      <>
                        <For each={[failed()]}>
                          {() => (
                            <SettingField
                              setting={{
                                key: 'enabled',
                                label: '開発者モードを有効化',
                                kind: 'toggle',
                                default: false,
                                value: d().enabled,
                              }}
                              disabled={busy() !== undefined}
                              onChange={(v) =>
                                void run(v ? '開発者モードを有効にしています' : '開発者モードを無効にしています', () =>
                                  change()({ ...d(), enabled: v === true }),
                                )
                              }
                            />
                          )}
                        </For>
                        <For each={['dir', 'repo'] as const}>
                          {(kind) => (
                            <div class={styles.places}>
                              <div class={styles.placesHead}>
                                <span>{PLACES[kind].label}</span>
                                <Show when={props.onPickDevPath}>
                                  <Button
                                    size="sm"
                                    disabled={busy() !== undefined}
                                    onClick={() => void addPath(d(), kind)}
                                  >
                                    {PLACES[kind].noun}を追加
                                  </Button>
                                </Show>
                              </div>
                              <For
                                each={d()[PLACES[kind].key]}
                                fallback={<p class={styles.empty}>{PLACES[kind].noun}が登録されていません</p>}
                              >
                                {(p) => (
                                  <div class={styles.place}>
                                    <span class={styles.path} data-tip={p}>
                                      {p}
                                    </span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={busy() !== undefined}
                                      onClick={() => removePath(d(), kind, p)}
                                    >
                                      削除
                                    </Button>
                                  </div>
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                        <Show when={props.onReload && d().enabled}>
                          <div class={styles.reload}>
                            <Button size="sm" disabled={busy() !== undefined} onClick={() => props.onReload?.()}>
                              プラグインを再読み込み
                            </Button>
                          </div>
                        </Show>
                      </>
                    )}
                  </Show>
                </>
              )}
            </Match>
          </Switch>
        </ScrollArea>
      </div>
    </div>
  )
}
