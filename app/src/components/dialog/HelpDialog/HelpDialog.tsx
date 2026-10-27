import { For, Show, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import styles from './HelpDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export const SHORTCUTS: [string, string][] = [
  ['Ctrl P', '検索バーを開く'],
  ['Ctrl Enter', '検索バーの入力内容でノートを作成'],
  ['Tab', '検索と AI モードを切り替え'],
  ['Ctrl U', '整理画面を開く'],
  ['Ctrl N', '新しいノートを作成'],
  ['Ctrl K / [[', 'ノートにリンクを挿入'],
  ['Esc', '閉じる / 前の画面に戻る'],
  ['Space / Enter', '選択中の項目を開く'],
  ['← →', '前後の素材へ移動（整理画面では → で保留、← で元に戻す）'],
  ['I', '素材の情報を表示 / 非表示'],
  ['Enter', 'タグの候補を承認（整理画面）'],
]

export interface HelpDialogProps {
  onClose?: () => void
}

export function HelpDialog(props: HelpDialogProps) {
  let el!: HTMLDivElement
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))
  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.frame} role="dialog" aria-label="ショートカット">
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <ScrollArea class={styles.root} viewClass={styles.body} tabIndex={-1} ref={el}>
          <h2>ショートカット</h2>
          <dl>
            <For each={SHORTCUTS}>
              {([k, d]) => (
                <>
                  <dt>{k}</dt>
                  <dd>{d}</dd>
                </>
              )}
            </For>
          </dl>
        </ScrollArea>
      </div>
    </div>
  )
}
