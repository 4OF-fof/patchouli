import { Index, Show } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { TabMenu } from '../TabMenu/TabMenu'
import type { TabStripProps } from '../TabStrip/TabStrip'
import { TabItem } from '../TabStrip/TabItem'
import { createTabRow } from '../TabStrip/row'
import styles from './PaneHead.module.css'

/** ペインのタブ。 */
export function PaneHead(props: TabStripProps) {
  let list!: HTMLDivElement
  const row = createTabRow(props, 'x', () => list)
  return (
    <div class={styles.root}>
      <div class={styles.bar}>
        <div
          ref={list}
          class={styles.list}
          role="tablist"
          aria-label="ペインのタブ"
          data-dragging={row.dragging() !== undefined || undefined}
        >
          <Index each={props.tabs}>
            {(t, i) => <TabItem tab={t} index={i} row={row} tabs={props} classes={styles} axis="x" />}
          </Index>
        </div>
        <button
          type="button"
          class={styles.add}
          aria-label="このペインで新しいタブを開く"
          onClick={() => props.onNew()}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <Show when={row.menu()} keyed>
        {(m) => (
          <TabMenu
            x={m.x}
            y={m.y}
            actions={m.actions}
            onAction={(a) => props.onAction?.(m.id, a)}
            onClose={() => row.setMenu(undefined)}
          />
        )}
      </Show>
    </div>
  )
}
