import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { Tabs } from '../../controls/Tabs/Tabs'
import styles from './ImportDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export interface DropFolder {
  key: number
  name: string
  files: number
  subfolders: number
}

type Mode = 'flat' | 'project'

const MODES: { key: Mode; label: string }[] = [
  { key: 'flat', label: 'ファイルのみ' },
  { key: 'project', label: 'プロジェクトを作成' },
]

export interface ImportDialogProps {
  files: number
  folders: DropFolder[]
  loose: number
  into?: string
  onImport?: (projects: number[]) => void
  onClose?: () => void
}

export function ImportDialog(props: ImportDialogProps) {
  let el!: HTMLDivElement
  const [modes, setModes] = createSignal<Record<number, Mode>>({})
  const modeOf = (key: number) => modes()[key] ?? 'flat'
  const dest = () => (props.into ? `「${props.into}」に追加` : 'プロジェクト未指定')
  const run = () => props.onImport?.(props.folders.filter((f) => modeOf(f.key) === 'project').map((f) => f.key))
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose?.()
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      run()
    }
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))
  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="取り込み" tabIndex={-1} ref={el}>
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <h2>{props.files} 件のファイルを取り込む</h2>
        <ScrollArea class={styles.list}>
          <ul>
            <For each={props.folders}>
              {(f) => (
                <li>
                  <i>
                    <Icon name={modeOf(f.key) === 'project' ? 'folder' : 'library'} />
                  </i>
                  <div class={styles.what}>
                    <b data-tip={f.name}>{f.name}</b>
                    <small>
                      {f.files} 件{f.subfolders > 0 && ` · サブフォルダ ${f.subfolders} 件`}
                    </small>
                  </div>
                  <Tabs
                    label={`${f.name} の取り込み方法`}
                    items={MODES}
                    value={modeOf(f.key)}
                    onChange={(m) => setModes({ ...modes(), [f.key]: m })}
                  />
                </li>
              )}
            </For>
            <Show when={props.loose > 0}>
              <li>
                <i>·</i>
                <div class={styles.what}>
                  <b>ファイル {props.loose} 件</b>
                  <small>フォルダ外のファイル</small>
                </div>
                <span class={styles.dest}>{dest()}</span>
              </li>
            </Show>
          </ul>
        </ScrollArea>
        <footer>
          <Button variant="ghost" onClick={() => props.onClose?.()}>
            キャンセル <Kbd>Esc</Kbd>
          </Button>
          <Button variant="primary" onClick={run}>
            取り込む <Kbd>Enter</Kbd>
          </Button>
        </footer>
      </div>
    </div>
  )
}
