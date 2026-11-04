import { For, Show } from 'solid-js'
import type { KnownLibrary } from '../../../backend/types'
import { touchedLabel } from '../../../model/library'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { DialogFrame } from '../DialogFrame/DialogFrame'
import styles from './LibrariesDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'
import { createBusy } from '../../../model/busy'

export interface LibrariesDialogProps {
  libraries?: KnownLibrary[]
  today?: Date
  onOpen?: (path: string) => Promise<void>
  onForget?: (path: string) => Promise<void>
  onChoose?: () => Promise<void>
  onClose?: () => void
}

export function LibrariesDialog(props: LibrariesDialogProps) {
  const { busy, error, run: start } = createBusy()

  const run = (label: string, job?: () => Promise<void>) => job && start(label, job)
  const today = () => props.today ?? new Date()

  return (
    <DialogFrame label="ライブラリ" overlayClass={styles.ov} class={styles.root} onClose={props.onClose}>
      <Show when={props.onClose}>
        <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
          <Icon name="close" />
        </IconButton>
      </Show>
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
                        data-tip={l.path}
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
                          data-tip="履歴から削除"
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
    </DialogFrame>
  )
}
