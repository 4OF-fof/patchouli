import { type JSX, For, Show, createEffect } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { Kbd } from '../../base/Kbd/Kbd'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Chip } from '../../controls/Chip/Chip'
import styles from './SearchPalette.module.css'

export type SearchMode = 'search' | 'command' | 'prompt' | 'link' | 'embed'

export type Hint = [key: string, label: string]

const MODES: Record<SearchMode, { label: string; placeholder: string; hints: Hint[] }> = {
  search: {
    label: '検索',
    placeholder: '名前・タグ・メモ・本文で検索',
    hints: [
      ['Enter', '開く'],
      ['Ctrl Enter', 'ノートを作成'],
      ['Esc', '閉じる'],
    ],
  },
  command: {
    label: '操作',
    placeholder: '操作を検索',
    hints: [
      ['Enter', '実行'],
      ['Backspace', '検索に戻る'],
      ['Esc', '閉じる'],
    ],
  },
  prompt: {
    label: 'AI',
    placeholder: '内容で検索（例：夕焼けの海、雨の音、会議の録音）',
    hints: [
      ['Enter', '開く'],
      ['Backspace', '検索に戻る'],
      ['Esc', '閉じる'],
    ],
  },
  link: {
    label: 'リンク先',
    placeholder: 'リンクするノートや素材を検索',
    hints: [
      ['Enter', 'リンク'],
      ['Ctrl Enter', 'ノートを作成'],
      ['Esc', '閉じる'],
    ],
  },
  embed: {
    label: '埋め込み',
    placeholder: '埋め込む素材を検索',
    hints: [
      ['Enter', '埋め込む'],
      ['Esc', '閉じる'],
    ],
  },
}

export interface SearchPaletteProps {
  mode?: SearchMode
  /** 確定した絞り込み。入力欄の前に並べる */
  chips?: string[]
  onRemoveChip?: (i: number) => void
  /** あれば、下の案内を差し替える */
  hints?: Hint[]
  query?: string
  results?: JSX.Element
  onClose?: () => void
  /** 結果の終わり近くまでスクロールしたときに呼ぶ */
  onMore?: () => void
  /** composing は、日本語入力で変換を確定する前か。確定したときにも呼ぶ */
  onQueryInput?: (query: string, composing: boolean) => void
  onInputKeyDown?: (e: KeyboardEvent) => void
}

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
          <Icon name="search" size={14} class={styles.glass} withText />
          <span class={styles.md} data-ai={props.mode === 'prompt'}>
            {mode().label}
          </span>
          <For each={props.chips}>
            {(c, i) => (
              <Chip
                class={styles.chip}
                tabIndex={-1}
                removeLabel="絞り込みを外す"
                onRemove={() => {
                  props.onRemoveChip?.(i())
                  input?.focus()
                }}
              >
                {c}
              </Chip>
            )}
          </For>
          <input
            ref={input}
            type="text"
            autocomplete="off"
            aria-label="検索キーワード"
            placeholder={mode().placeholder}
            value={props.query ?? ''}
            onInput={(e) => props.onQueryInput?.(e.currentTarget.value, e.isComposing)}
            onCompositionEnd={(e) => props.onQueryInput?.(e.currentTarget.value, false)}
            onKeyDown={(e) => props.onInputKeyDown?.(e)}
          />
        </div>
        <Show when={props.results}>
          <ScrollArea
            class={styles.res}
            viewClass={styles.resView}
            role="listbox"
            ref={(el) =>
              el.addEventListener(
                'scroll',
                () => el.scrollHeight - el.scrollTop - el.clientHeight < 160 && props.onMore?.(),
                { passive: true },
              )
            }
          >
            {props.results}
          </ScrollArea>
        </Show>
        <div class={styles.ht}>
          <For each={props.hints ?? mode().hints}>
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
