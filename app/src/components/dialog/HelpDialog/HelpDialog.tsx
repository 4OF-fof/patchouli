import { For, Show } from 'solid-js'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { DialogFrame } from '../DialogFrame/DialogFrame'
import styles from './HelpDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export const SHORTCUTS: [string, string][] = [
  ['Ctrl P', '検索バーを開く'],
  ['Ctrl Enter', '検索バーの入力内容でノートを作成'],
  ['# / @ / .', '検索でタグ・場所・種類で絞り込む'],
  ['-', '検索で、続く語を含むものを除く'],
  ['"…"', '検索で、空白を含む語句をひとかたまりで探す'],
  ['>', '検索で操作を探す（検索欄の先頭で）'],
  ['?', '検索で AI モードに入る（検索欄の先頭で）'],
  ['Ctrl U', '分類の確認を開く'],
  ['Ctrl N', '新しいノートを作成'],
  ['Ctrl K / [[', 'ノートにリンクを挿入'],
  ['Esc', '閉じる'],
  ['Space / Enter', '選択中の項目を開く'],
  ['← →', '前後の素材へ移動（分類の確認では → で保留、← で元に戻す）'],
  ['I', '素材の情報を表示 / 非表示'],
  ['Enter', 'タグの候補を承認（分類の確認）'],
]

export interface HelpDialogProps {
  onClose?: () => void
}

export function HelpDialog(props: HelpDialogProps) {
  let el!: HTMLDivElement
  return (
    <DialogFrame
      label="ショートカット"
      overlayClass={styles.ov}
      class={styles.frame}
      onClose={props.onClose}
      focus={() => el}
    >
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
    </DialogFrame>
  )
}
