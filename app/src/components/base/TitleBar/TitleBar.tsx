import { Show } from 'solid-js'
import styles from './TitleBar.module.css'

export interface TitleBarProps {
  /** 左に出すアプリのアイコン。 */
  icon?: string
  maximized?: boolean
  onMinimize?: () => void
  onToggleMaximize?: () => void
  onClose?: () => void
}

/** 窓の上の段。つかむと窓を動かせ、右に最小化・最大化・閉じるを置く。 */
export function TitleBar(props: TitleBarProps) {
  return (
    <header class={styles.root} data-tauri-drag-region>
      <Show when={props.icon}>{(src) => <img class={styles.icon} src={src()} alt="" data-tauri-drag-region />}</Show>
      <div class={styles.buttons}>
        <button type="button" aria-label="最小化" onClick={() => props.onMinimize?.()}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={props.maximized ? '元に戻す' : '最大化'}
          onClick={() => props.onToggleMaximize?.()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <Show when={props.maximized} fallback={<rect x="0.5" y="0.5" width="9" height="9" />}>
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 2.5v-2h7v7h-2" />
            </Show>
          </svg>
        </button>
        <button type="button" class={styles.close} aria-label="閉じる" onClick={() => props.onClose?.()}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
          </svg>
        </button>
      </div>
    </header>
  )
}
