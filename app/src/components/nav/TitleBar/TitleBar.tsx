import { type Accessor, type JSX, Show, createContext, useContext } from 'solid-js'
import styles from './TitleBar.module.css'

/** デスクトップの窓を動かす操作。web では無い。 */
export interface WindowControls {
  /** 左に出すアプリのアイコン。 */
  maximized: Accessor<boolean>
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

const WindowContext = createContext<WindowControls>()
export const WindowProvider = WindowContext.Provider
export const useWindowControls = () => useContext(WindowContext)

export interface TitleBarProps {
  /** 左に並べるもの（メニュー・戻る・いまの場所）。 */
  children?: JSX.Element
  /** 窓のボタンの左に置くもの。 */
  end?: JSX.Element
  /** 省略すると、デスクトップの窓から受け取る。 */
  window?: WindowControls
}

/** 画面の上の段。空いている所をつかむと窓を動かせ、右に最小化・最大化・閉じるを置く。 */
export function TitleBar(props: TitleBarProps) {
  const fromFrame = useWindowControls()
  const win = () => props.window ?? fromFrame
  return (
    <header class={styles.root} data-tauri-drag-region>
      <div class={styles.start}>{props.children}</div>
      <span class={styles.drag} data-tauri-drag-region />
      {props.end}
      <Show when={win()}>
        {(w) => (
          <div class={styles.buttons}>
            <button type="button" aria-label="最小化" onClick={() => w().onMinimize()}>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0 5.5h10" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={w().maximized() ? '元に戻す' : '最大化'}
              onClick={() => w().onToggleMaximize()}
            >
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <Show when={w().maximized()} fallback={<rect x="0.5" y="0.5" width="9" height="9" />}>
                  <rect x="0.5" y="2.5" width="7" height="7" />
                  <path d="M2.5 2.5v-2h7v7h-2" />
                </Show>
              </svg>
            </button>
            <button type="button" class={styles.close} aria-label="閉じる" onClick={() => w().onClose()}>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
              </svg>
            </button>
          </div>
        )}
      </Show>
    </header>
  )
}
