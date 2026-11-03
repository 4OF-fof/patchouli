import { Index, Show, createEffect } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { type TabAction, TabMenu } from '../TabMenu/TabMenu'
import { createTabUnits, faceOf } from './units'
import styles from './TabStrip.module.css'

export interface TabEntry {
  id: number
  label: string
  icon: IconName
  /** 分割して並べるまとまりの番号。同じ番号のタブは続けて並べる。 */
  group?: number
  /** まとまりの中で、最後に操作したタブ。たたんだときに表に出す。 */
  face?: boolean
  /** 分割して、いま並べて見えている。 */
  shown?: boolean
}

export interface TabStripProps {
  tabs: TabEntry[]
  current: number
  onSelect: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
  onAction?: (id: number, a: TabAction) => void
  /** id のタブを、まとまりごと before の前に動かす。before がなければ末尾。 */
  onMove?: (id: number, before: number | undefined) => void
}

/** タイトルバーに並べるタブ。中クリックでも閉じる。分割したタブは、見えていないときは 1 つにたたむ。 */
export function TabStrip(props: TabStripProps) {
  let list!: HTMLDivElement
  const s = createTabUnits(props, 'x', () => list)
  const seg = (t: () => TabEntry) => (
    <div class={styles.seg} data-current={t().id === props.current} onContextMenu={(e) => s.openMenu(t(), e)}>
      <button
        type="button"
        role="tab"
        class={styles.main}
        aria-selected={t().id === props.current}
        data-tip={t().label}
        onClick={() => props.onSelect(t().id)}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && props.onClose(t().id)}
      >
        <Icon name={t().icon} size={14} />
        <span class={styles.label}>{t().label}</span>
      </button>
      <button
        type="button"
        class={styles.close}
        aria-label={`「${t().label}」を閉じる`}
        onClick={() => props.onClose(t().id)}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
  return (
    <div class={styles.root}>
      <div
        ref={list}
        class={styles.list}
        role="tablist"
        aria-label="タブ"
        data-dragging={s.dragging() !== undefined || undefined}
      >
        <Index each={s.units()}>
          {(u, i) => {
            let el!: HTMLDivElement
            const current = () => u().tabs.some((t) => t.id === props.current)
            const folded = () => u().group && !current()
            const face = () => faceOf(u())
            createEffect(() => {
              if (current()) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            })
            return (
              <div
                ref={el}
                class={styles.tab}
                style={{ '--panes': folded() ? 1 : u().tabs.length, transform: s.shift(i) }}
                data-unit
                data-current={current()}
                data-group={u().group ? (folded() ? 'folded' : 'open') : undefined}
                data-dragged={s.dragging() === i || undefined}
                onPointerDown={(e) => s.startDrag(i, e)}
              >
                <Show when={folded()} fallback={<Index each={u().tabs}>{seg}</Index>}>
                  <div class={styles.seg}>
                    <button
                      type="button"
                      role="tab"
                      class={styles.main}
                      aria-selected={false}
                      data-tip={u()
                        .tabs.map((t) => t.label)
                        .join('、')}
                      onClick={() => {
                        const f = face()
                        if (f) props.onSelect(f.id)
                      }}
                      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                      onAuxClick={(e) => e.button === 1 && s.closeAll(u())}
                    >
                      <Icon name="splitRight" size={14} />
                      <span class={styles.label}>{face()?.label}</span>
                      <span class={styles.count}>{u().tabs.length}</span>
                    </button>
                    <button
                      type="button"
                      class={styles.close}
                      aria-label={`「${face()?.label ?? ''}」など ${u().tabs.length} 件のタブを閉じる`}
                      onClick={() => s.closeAll(u())}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </Show>
              </div>
            )
          }}
        </Index>
      </div>
      <Show when={s.menu()} keyed>
        {(m) => (
          <TabMenu
            x={m.x}
            y={m.y}
            actions={m.actions}
            onAction={(a) => props.onAction?.(m.id, a)}
            onClose={() => s.setMenu(undefined)}
          />
        )}
      </Show>
      <button
        type="button"
        class={styles.add}
        aria-label="新しいタブ"
        data-tip="新しいタブ"
        onClick={() => props.onNew()}
      >
        <Icon name="plus" />
      </button>
    </div>
  )
}
