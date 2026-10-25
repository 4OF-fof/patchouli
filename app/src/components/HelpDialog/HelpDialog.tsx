import { For, onCleanup, onMount } from 'solid-js'
import styles from './HelpDialog.module.css'

/** キーと、そのキーでできること。 */
export const SHORTCUTS: [string, string][] = [
  ['Ctrl P', '下の検索バーに入る（どの画面からでも）'],
  ['Ctrl Enter', '検索バーで、入力した名前のノートを作る'],
  ['Tab', '検索バーで、検索とプロンプトを切り替える'],
  ['Ctrl U', '整理を開く'],
  ['Ctrl N', '新しいノート'],
  ['Ctrl K / [[', 'ノートにリンクを入れる'],
  ['Esc', '閉じる・来た画面に戻る'],
  ['Space / Enter', '指しているものを開く'],
  ['← →', '素材の画面と自動分類の確認で前後へ（確認では → があとで）'],
  ['I', '素材の情報を出す・隠す'],
  ['Enter', '自動分類の確認で承認'],
  ['Ctrl Z', '直前の整理を取り消す'],
]

export interface HelpDialogProps {
  onClose?: () => void
}

/** キー操作の一覧。後ろを暗くして上に重ねる。置き場所の要素に position: relative を付けておく。 */
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
      <div class={styles.root} role="dialog" aria-label="ショートカット" tabIndex={-1} ref={el}>
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
      </div>
    </div>
  )
}
