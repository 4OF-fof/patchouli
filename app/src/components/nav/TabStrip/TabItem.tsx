import { Show, createEffect } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import type { TabEntry, TabStripProps } from './TabStrip'
import type { TabRow } from './row'

/** タブの列の、タブ 1 つ分。 */
export function TabItem(props: {
  tab: () => TabEntry
  index: number
  row: TabRow
  tabs: TabStripProps
  /** 置く側の見た目。タブの列ごとの CSS Modules（tab・seg・main・label・count・close）を渡す */
  classes: Readonly<Record<string, string>>
  axis: 'x' | 'y'
}) {
  let el!: HTMLDivElement
  const c = () => props.classes
  const t = () => props.tab()
  const selected = () => t().id === props.tabs.current
  const folded = () => (t().count ?? 0) > 1
  createEffect(() => {
    if (selected()) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
  return (
    <div
      ref={el}
      class={c().tab}
      style={{ transform: props.row.shift(props.index) }}
      data-tab
      data-current={selected()}
      data-dragged={props.row.dragging() === props.index || undefined}
      data-lifted={props.row.lifted() === props.index || undefined}
      data-drop={props.row.dropAt(props.index)}
      onPointerDown={(e) => props.row.startDrag(props.index, e)}
    >
      <div class={c().seg} data-current={selected()} onContextMenu={(e) => props.row.openMenu(t(), e)}>
        <button
          type="button"
          role="tab"
          class={c().main}
          aria-selected={selected()}
          tabIndex={selected() ? 0 : -1}
          data-tip={t().label}
          onClick={() => props.tabs.onSelect(t().id)}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={(e) => e.button === 1 && props.tabs.onClose(t().id)}
          onKeyDown={(e) => rove(props.axis, e)}
        >
          <Icon name={folded() ? 'workspace' : t().icon} size={14} />
          <span class={c().label}>{t().label}</span>
          <Show when={folded()}>
            <span class={c().count}>{t().count}</span>
          </Show>
        </button>
        <button
          type="button"
          class={c().close}
          tabIndex={selected() ? 0 : -1}
          aria-label={folded() ? `「${t().label}」など ${t().count} 件のタブを閉じる` : `「${t().label}」を閉じる`}
          onClick={() => props.tabs.onClose(t().id)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  )
}

/** タブの列の矢印キー。フォーカスを隣のタブへ動かす（選ぶのは Enter か Space）。 */
function rove(axis: 'x' | 'y', e: KeyboardEvent & { currentTarget: HTMLElement }) {
  const [prev, next] = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  const list = e.currentTarget.closest('[role="tablist"]')
  if (!list) return
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
  const at = tabs.indexOf(e.currentTarget)
  const to =
    e.key === prev ? at - 1 : e.key === next ? at + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -2
  if (to === -2) return
  e.preventDefault()
  tabs[(to + tabs.length) % tabs.length]?.focus()
}
