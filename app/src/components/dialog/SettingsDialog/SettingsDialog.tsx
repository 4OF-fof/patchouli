import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { CacheKind, CacheUsage, Developer, UnusedPlugin } from '../../../backend/types'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import styles from './SettingsDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export interface SettingsDialogProps {
  version: string
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

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="設定" tabIndex={-1} ref={el}>
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <h2>設定</h2>
        <ScrollArea class={styles.main} viewClass={styles.mainView}>
          <Show when={busy() || error()}>
            <p class={styles.status} data-error={!!error()} role="status">
              {error() ?? `${busy()}…`}
            </p>
          </Show>
          <section>
            <h4>アプリ</h4>
            <div class={styles.row}>
              <b>Patchouli</b>
              <span class={styles.mono}>{props.version}</span>
            </div>
          </section>
          <Show when={props.onClear || props.onRemoveUnused}>
            <section>
              <h4>キャッシュ</h4>
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
                      {props.unused ? `${props.unused.length} 件 · ${bytesLabel(unusedBytes())}` : '…'}
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
            </section>
          </Show>
          <Show when={props.onDeveloperChange}>
            {(change) => (
              <section>
                <h4>開発者モード</h4>
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
              </section>
            )}
          </Show>
        </ScrollArea>
      </div>
    </div>
  )
}
