import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { CacheKind, CacheUsage, UnusedPlugin } from '../../../backend/types'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import styles from './OtherDialog.module.css'

export interface OtherDialogProps {
  /** アプリの版。 */
  version: string
  /** ないあいだは読み込み中と出す。 */
  usage?: CacheUsage
  /** どのライブラリでも使っていないプラグイン。ないあいだは読み込み中と出す。 */
  unused?: UnusedPlugin[]
  /** キャッシュを消す。all は未使用のプラグインも消す。ないときはキャッシュの行を出さない。 */
  onClear?: (kind: CacheKind) => Promise<void>
  /** 使っていないプラグインをまとめて消す。ないときはその行を出さない。 */
  onRemoveUnused?: () => Promise<void>
  onClose?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 「12.3 MB」のような大きさ。 */
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
  { kind: 'library', label: 'ライブラリの写し' },
  { kind: 'thumbs', label: 'サムネイル' },
  { kind: 'all', label: 'すべて' },
]

/** 設定の「その他」。アプリの版と、キャッシュ・使っていないプラグインの削除。置き場所の要素に position: relative を付けておく。 */
export function OtherDialog(props: OtherDialogProps) {
  let el!: HTMLDivElement
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
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
    } finally {
      setBusy(undefined)
    }
  }
  const unusedBytes = () => (props.unused ?? []).reduce((n, p) => n + p.bytes, 0)
  const sizeOf = (u: CacheUsage, kind: CacheKind) =>
    kind === 'library' ? u.library : kind === 'thumbs' ? u.thumbs : u.library + u.thumbs + unusedBytes()

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="その他" tabIndex={-1} ref={el}>
        <h2>その他</h2>
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
                          onClick={() => void run(`${c.label}を消しています`, () => clear()(c.kind))}
                        >
                          消す
                        </Button>
                      </div>
                    )}
                  </For>
                )}
              </Show>
              <Show when={props.onRemoveUnused}>
                {(remove) => (
                  <div class={styles.row}>
                    <b title={props.unused?.map((p) => p.name).join('、')}>未使用のプラグイン</b>
                    <span class={styles.mono}>
                      {props.unused ? `${props.unused.length} 件 · ${bytesLabel(unusedBytes())}` : '…'}
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy() !== undefined || !props.unused?.length}
                      onClick={() => void run('未使用のプラグインを消しています', remove())}
                    >
                      消す
                    </Button>
                  </div>
                )}
              </Show>
            </section>
          </Show>
        </ScrollArea>
      </div>
    </div>
  )
}
