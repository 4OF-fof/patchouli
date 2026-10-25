import { type JSX, For, Show, createEffect, onCleanup } from 'solid-js'
import { Kbd } from '../Kbd/Kbd'
import styles from './SearchDock.module.css'

/** search 検索 / prompt AI へのプロンプト / link ノートにつなぐ先を探す */
export type DockMode = 'search' | 'prompt' | 'link'

const MODES: Record<DockMode, { label: string; placeholder: string; hints: [string, string][] }> = {
  search: {
    label: '検索',
    placeholder: '名前・プロジェクト・タグ・本文で探す',
    hints: [
      ['Tab', 'AI に頼む'],
      ['Enter', '開く'],
      ['Ctrl Enter', 'ノートを作る'],
      ['Esc', '閉じる'],
    ],
  },
  prompt: {
    label: 'AI',
    placeholder: 'AI に頼む（例：秋の企画の素材から、配色の候補を 3 つ出して）',
    hints: [
      ['Tab', '検索に戻る'],
      ['Enter', '送る'],
      ['Esc', '閉じる'],
    ],
  },
  link: {
    label: 'つなぐ先',
    placeholder: 'つなぐノートや素材を探す',
    hints: [
      ['Enter', 'つなぐ'],
      ['Esc', '閉じる'],
    ],
  },
}

export interface SearchDockProps {
  /** 入力中。結果が上に伸び、後ろの画面を暗くする。 */
  open?: boolean
  mode?: DockMode
  query?: string
  /** ResultRow / ResultHeading を並べる。 */
  results?: JSX.Element
  /** ☰ から開く NavMenu。 */
  menu?: JSX.Element
  menuOpen?: boolean
  /** 保存先に書き込めないとき。＋ を使えなくする。 */
  readOnly?: boolean
  onOpen?: () => void
  onClose?: () => void
  onQueryInput?: (query: string) => void
  onInputKeyDown?: (e: KeyboardEvent) => void
  onMenuToggle?: () => void
  onCreate?: () => void
}

/** 画面の下の中央に浮かぶ検索バー。☰・検索・＋ だけを置く。 */
export function SearchDock(props: SearchDockProps) {
  let input: HTMLInputElement | undefined
  let root!: HTMLDivElement
  const mode = () => MODES[props.mode ?? 'search']
  createEffect(() => {
    if (props.open) queueMicrotask(() => input?.focus())
  })
  // メニューは検索バーの外を押すと閉じる
  createEffect(() => {
    if (!props.menuOpen) return
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.contains(e.target)) props.onClose?.()
    }
    document.addEventListener('pointerdown', away)
    onCleanup(() => document.removeEventListener('pointerdown', away))
  })
  return (
    <>
      <Show when={props.open}>
        <div class={styles.scrim} role="presentation" onMouseDown={() => props.onClose?.()} />
      </Show>
      <div class={styles.root} ref={root} data-open={!!props.open} role="search">
        <Show when={props.open && props.results}>
          <div class={styles.res} role="listbox">
            {props.results}
          </div>
        </Show>
        <div class={styles.in}>
          <Show
            when={props.open}
            fallback={
              <>
                <button
                  type="button"
                  class={styles.ib}
                  aria-label="メニュー"
                  title="メニュー"
                  aria-haspopup="menu"
                  aria-expanded={!!props.menuOpen}
                  onClick={() => props.onMenuToggle?.()}
                >
                  ☰
                </button>
                <button type="button" class={styles.sr} onClick={() => props.onOpen?.()}>
                  ⌕ 検索<Kbd class={styles.kbd}>Ctrl P</Kbd>
                </button>
              </>
            }
          >
            <span class={styles.md} data-ai={props.mode === 'prompt'}>
              {mode().label}
            </span>
            <input
              ref={input}
              type="text"
              autocomplete="off"
              aria-label="検索語"
              placeholder={mode().placeholder}
              value={props.query ?? ''}
              onInput={(e) => props.onQueryInput?.(e.currentTarget.value)}
              onKeyDown={(e) => props.onInputKeyDown?.(e)}
            />
          </Show>
          <button
            type="button"
            class={styles.nw}
            aria-label="新しいノート"
            title="新しいノート"
            disabled={props.readOnly}
            onClick={() => props.onCreate?.()}
          >
            ＋
          </button>
        </div>
        <Show when={props.open}>
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
        </Show>
        <Show when={!props.open && props.menuOpen}>
          <div class={styles.menu}>{props.menu}</div>
        </Show>
      </div>
    </>
  )
}
