import { For, createEffect, on } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { Kbd } from '../../base/Kbd/Kbd'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { coverPage } from '../../media/WebPage/layer'
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
  danger?: boolean
  /** 右にサブメニューを出す */
  sub?: boolean
}

export type NavMenuEntry = NavMenuItem | 'separator'

export interface NavMenuProps {
  items: NavMenuEntry[]
  onSelect?: (id: string, el: HTMLButtonElement) => void
  onHover?: (id: string, el: HTMLButtonElement) => void
  /** sub の項目で → を押したとき */
  onExpand?: (id: string, el: HTMLButtonElement) => void
  /** サブメニューを開いている項目 */
  open?: string
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
    if (e.key === 'ArrowRight') {
      const b = document.activeElement
      if (!(b instanceof HTMLButtonElement)) return
      const it = props.items.filter((x) => x !== 'separator')[buttons().indexOf(b)]
      if (!it?.sub) return
      e.preventDefault()
      props.onExpand?.(it.id, b)
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
    <div
      class={styles.root}
      role="menu"
      tabIndex={-1}
      ref={(e) => {
        el = e
        coverPage(e)
      }}
      onKeyDown={onKeyDown}
    >
      <ScrollArea class={styles.scroll} viewClass={styles.list}>
        <For each={props.items}>
          {(it) =>
            it === 'separator' ? (
              <hr />
            ) : (
              <button
                type="button"
                role="menuitem"
                aria-current={it.current ? 'page' : undefined}
                aria-haspopup={it.sub ? 'menu' : undefined}
                aria-expanded={it.sub ? props.open === it.id : undefined}
                data-heading={it.heading}
                data-danger={it.danger}
                data-tip={it.title}
                onClick={(e) => props.onSelect?.(it.id, e.currentTarget)}
                onPointerEnter={(e) => props.onHover?.(it.id, e.currentTarget)}
              >
                <i>{it.icon && <Icon name={it.icon} withText />}</i>
                <span class={styles.label}>{it.label}</span>
                {it.count != null && <small>{it.count}</small>}
                {it.hint && <small>{it.hint}</small>}
                {it.kbd && <Kbd class={styles.kbd}>{it.kbd}</Kbd>}
                {it.sub && <Icon name="chevron" size={12} class={styles.sub} withText />}
              </button>
            )
          }
        </For>
      </ScrollArea>
    </div>
  )
}
