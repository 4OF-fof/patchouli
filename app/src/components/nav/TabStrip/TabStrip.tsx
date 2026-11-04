import { Index, Show } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { type TabAction, TabMenu } from '../TabMenu/TabMenu'
import { TabUnitView } from './TabUnitView'
import { createTabUnits } from './units'
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
          {(u, i) => (
            <TabUnitView
              unit={u}
              index={i}
              units={s}
              tabs={props}
              classes={styles}
              style={{
                '--panes': u().group && !u().tabs.some((t) => t.id === props.current) ? 1 : u().tabs.length,
              }}
              axis="x"
            />
          )}
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
