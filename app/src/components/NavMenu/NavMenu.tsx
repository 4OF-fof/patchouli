import { For, createEffect, on } from 'solid-js'
import { Kbd } from '../Kbd/Kbd'
import styles from './NavMenu.module.css'

export interface NavMenuItem {
  id: string
  icon?: string
  label: string
  count?: number
  kbd?: string
  /** いま開いている画面の項目。 */
  current?: boolean
  /** 見出しとして薄く出す（例：設定を開いたときの「設定」）。 */
  heading?: boolean
}

export type NavMenuEntry = NavMenuItem | 'separator'

export interface NavMenuProps {
  items: NavMenuEntry[]
  onSelect?: (id: string) => void
  /** Esc で閉じるとき。 */
  onClose?: () => void
  /** 開いたときと項目が差し替わったときに、先頭の項目へフォーカスする。 */
  focusFirst?: boolean
}

/** 検索バーの左の ☰ から開くメニュー。画面が増えたら項目を足す。 */
export function NavMenu(props: NavMenuProps) {
  let el!: HTMLDivElement
  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('button')]
  // 項目が差し替わる（設定を開く）とフォーカスが外れるので、先頭に戻す
  createEffect(
    on(
      () => props.items,
      () => {
        if (props.focusFirst) queueMicrotask(() => buttons()[0]?.focus())
      },
    ),
  )
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      props.onClose?.()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const bs = buttons()
    const i = bs.findIndex((b) => b === document.activeElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % bs.length : (i - 1 + bs.length) % bs.length
    bs[next]?.focus()
  }
  return (
    <div class={styles.root} role="menu" tabIndex={-1} ref={el} onKeyDown={onKeyDown}>
      <For each={props.items}>
        {(it) =>
          it === 'separator' ? (
            <hr />
          ) : (
            <button
              type="button"
              role="menuitem"
              aria-current={it.current ? 'page' : undefined}
              data-heading={it.heading}
              onClick={() => props.onSelect?.(it.id)}
            >
              <i>{it.icon}</i>
              {it.label}
              {it.count != null && <small>{it.count}</small>}
              {it.kbd && <Kbd class={styles.kbd}>{it.kbd}</Kbd>}
            </button>
          )
        }
      </For>
    </div>
  )
}
