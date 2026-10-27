import { type JSX, For, Show, createEffect } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { Kbd } from '../../base/Kbd/Kbd'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import styles from './SearchPalette.module.css'

/** search 検索 / prompt AI へのプロンプト / link ノートにつなぐ先を探す */
export type SearchMode = 'search' | 'prompt' | 'link'

const MODES: Record<SearchMode, { label: string; placeholder: string; hints: [string, string][] }> = {
  search: {
    label: '検索',
    placeholder: '名前・プロジェクト・タグ・本文で検索',
    hints: [
      ['Tab', 'AI に質問'],
      ['Enter', '開く'],
      ['Ctrl Enter', 'ノートを作成'],
      ['Esc', '閉じる'],
    ],
  },
  prompt: {
    label: 'AI',
    placeholder: 'AI に質問・依頼（例：秋の企画の素材から配色の候補を 3 つ挙げて）',
    hints: [
      ['Tab', '検索に戻る'],
      ['Enter', '送信'],
      ['Esc', '閉じる'],
    ],
  },
  link: {
    label: 'リンク先',
    placeholder: 'リンクするノートや素材を検索',
    hints: [
      ['Enter', 'リンク'],
      ['Esc', '閉じる'],
    ],
  },
}

export interface SearchPaletteProps {
  mode?: SearchMode
  query?: string
  /** ResultRow / ResultHeading を並べる。 */
  results?: JSX.Element
  onClose?: () => void
  onQueryInput?: (query: string) => void
  onInputKeyDown?: (e: KeyboardEvent) => void
}

/** Ctrl P で開く検索。画面の上のほうに浮かべ、後ろを暗くする。 */
export function SearchPalette(props: SearchPaletteProps) {
  let input: HTMLInputElement | undefined
  const mode = () => MODES[props.mode ?? 'search']
  createEffect(() => {
    void props.mode
    queueMicrotask(() => input?.focus())
  })
  return (
    <div
      class={styles.scrim}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}
    >
      <div class={styles.root} role="search">
        <div class={styles.in}>
          <Icon name="search" size={14} class={styles.glass} />
          <span class={styles.md} data-ai={props.mode === 'prompt'}>
            {mode().label}
          </span>
          <input
            ref={input}
            type="text"
            autocomplete="off"
            aria-label="検索キーワード"
            placeholder={mode().placeholder}
            value={props.query ?? ''}
            onInput={(e) => props.onQueryInput?.(e.currentTarget.value)}
            onKeyDown={(e) => props.onInputKeyDown?.(e)}
          />
        </div>
        <Show when={props.results}>
          <ScrollArea class={styles.res} viewClass={styles.resView} role="listbox">
            {props.results}
          </ScrollArea>
        </Show>
        <div class={styles.ht}>
          <For each={mode().hints}>
            {([k, label]) => (
              <span>
                <Kbd class={styles.kbd}>{k}</Kbd>
                {label}
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
