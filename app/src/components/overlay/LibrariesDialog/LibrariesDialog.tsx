import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { KnownLibrary } from '../../../backend/types'
import { touchedLabel } from '../../../model/library'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import styles from './LibrariesDialog.module.css'
import { Icon } from '../../base/Icon/Icon'

export interface LibrariesDialogProps {
  /** 最後に開いた順。ないあいだは読み込み中と出す。 */
  libraries?: KnownLibrary[]
  /** 開いた日の言い方の基準。省略すると今。 */
  today?: Date
  /** 履歴のライブラリに切り替える。 */
  onOpen?: (path: string) => Promise<void>
  /** 履歴から外す。 */
  onForget?: (path: string) => Promise<void>
  /** フォルダを選んで切り替える。 */
  onChoose?: () => Promise<void>
  onClose?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 開いたことのあるライブラリの一覧。選ぶと切り替える。置き場所の要素に position: relative を付けておく。 */
export function LibrariesDialog(props: LibrariesDialogProps) {
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

  const run = async (label: string, job?: () => Promise<void>) => {
    if (!job) return
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
  const today = () => props.today ?? new Date()

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="ライブラリ" tabIndex={-1} ref={el}>
        <h2>ライブラリ</h2>
        <Show when={busy() || error()}>
          <p class={styles.status} data-error={!!error()} role="status">
            {error() ?? `${busy()}…`}
          </p>
        </Show>
        <ScrollArea class={styles.list} viewClass={styles.listView}>
          <Show when={props.libraries} fallback={<p class={styles.none}>読み込み中…</p>}>
            {(ls) => (
              <Show when={ls().length} fallback={<p class={styles.none}>履歴がありません</p>}>
                <ul>
                  <For each={ls()}>
                    {(l) => (
                      <li data-missing={!l.exists} data-current={l.current}>
                        <button
                          type="button"
                          class={styles.open}
                          disabled={!l.exists || l.current || busy() !== undefined}
                          title={l.path}
                          onClick={() =>
                            void run(`${l.name} を開いています`, props.onOpen && (() => props.onOpen!(l.path)))
                          }
                        >
                          <b>{l.name}</b>
                          <span class={styles.path}>{l.path}</span>
                        </button>
                        <span class={styles.when}>
                          {l.current ? '使用中' : l.exists ? touchedLabel(today(), new Date(l.opened)) : '未検出'}
                        </span>
                        <Show when={!l.current && props.onForget}>
                          <button
                            type="button"
                            class={styles.forget}
                            aria-label={`${l.name} を履歴から削除`}
                            title="履歴から削除"
                            disabled={busy() !== undefined}
                            onClick={() => void run('', () => props.onForget!(l.path))}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </ScrollArea>
        <Show when={props.onChoose}>
          <div class={styles.foot}>
            <Button
              variant="primary"
              disabled={busy() !== undefined}
              onClick={() => void run('フォルダを選択しています', props.onChoose)}
            >
              フォルダを選択…
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )
}
