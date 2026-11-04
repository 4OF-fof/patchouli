import { Index, type JSX, Show, createEffect } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import type { TabEntry, TabStripProps } from './TabStrip'
import { type TabUnit, type TabUnits, faceOf } from './units'

/** タブの列の、まとまり 1 つ分。分割したタブは、見えていないときは 1 つにたたむ。 */
export function TabUnitView(props: {
  unit: () => TabUnit
  index: number
  units: TabUnits
  tabs: TabStripProps
  /** 置く側の見た目。タブの列ごとの CSS Modules（tab・seg・main・label・count・close）を渡す */
  classes: Readonly<Record<string, string>>
  style?: JSX.CSSProperties
  axis: 'x' | 'y'
}) {
  let el!: HTMLDivElement
  const c = () => props.classes
  const current = () => props.unit().tabs.some((t) => t.id === props.tabs.current)
  const folded = () => props.unit().group && !current()
  const face = () => faceOf(props.unit())
  createEffect(() => {
    if (current()) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
  const seg = (t: () => TabEntry) => {
    const selected = () => t().id === props.tabs.current
    return (
      <div class={c().seg} data-current={selected()} onContextMenu={(e) => props.units.openMenu(t(), e)}>
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
          <Icon name={t().icon} size={14} />
          <span class={c().label}>{t().label}</span>
        </button>
        <button
          type="button"
          class={c().close}
          tabIndex={selected() ? 0 : -1}
          aria-label={`「${t().label}」を閉じる`}
          onClick={() => props.tabs.onClose(t().id)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    )
  }
  return (
    <div
      ref={el}
      class={c().tab}
      style={{ ...props.style, transform: props.units.shift(props.index) }}
      data-unit
      data-current={current()}
      data-group={props.unit().group ? (folded() ? 'folded' : 'open') : undefined}
      data-dragged={props.units.dragging() === props.index || undefined}
      onPointerDown={(e) => props.units.startDrag(props.index, e)}
    >
      <Show when={folded()} fallback={<Index each={props.unit().tabs}>{seg}</Index>}>
        <div class={c().seg}>
          <button
            type="button"
            role="tab"
            class={c().main}
            aria-selected={false}
            tabIndex={-1}
            data-tip={props
              .unit()
              .tabs.map((t) => t.label)
              .join('、')}
            onClick={() => {
              const f = face()
              if (f) props.tabs.onSelect(f.id)
            }}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.button === 1 && props.units.closeAll(props.unit())}
            onKeyDown={(e) => rove(props.axis, e)}
          >
            <Icon name="splitRight" size={14} />
            <span class={c().label}>{face()?.label}</span>
            <span class={c().count}>{props.unit().tabs.length}</span>
          </button>
          <button
            type="button"
            class={c().close}
            tabIndex={-1}
            aria-label={`「${face()?.label ?? ''}」など ${props.unit().tabs.length} 件のタブを閉じる`}
            onClick={() => props.units.closeAll(props.unit())}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </Show>
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
