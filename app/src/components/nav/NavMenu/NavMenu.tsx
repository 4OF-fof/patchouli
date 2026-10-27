import { For, createEffect, on } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { Kbd } from '../../base/Kbd/Kbd'
import styles from './NavMenu.module.css'

export interface NavMenuItem {
  id: string
  icon?: IconName
  label: string
  count?: number
  kbd?: string
  hint?: string
  title?: string
  current?: boolean
  heading?: boolean
}

export type NavMenuEntry = NavMenuItem | 'separator'

export interface NavMenuProps {
  items: NavMenuEntry[]
  onSelect?: (id: string) => void
  onClose?: () => void
  focusFirst?: boolean
}

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
              title={it.title}
              onClick={() => props.onSelect?.(it.id)}
            >
              <i>{it.icon && <Icon name={it.icon} />}</i>
              {it.label}
              {it.count != null && <small>{it.count}</small>}
              {it.hint && <small>{it.hint}</small>}
              {it.kbd && <Kbd class={styles.kbd}>{it.kbd}</Kbd>}
            </button>
          )
        }
      </For>
    </div>
  )
}
