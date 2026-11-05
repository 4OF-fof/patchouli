import { Index, Show } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { type TabAction, TabMenu } from '../TabMenu/TabMenu'
import { TabItem } from './TabItem'
import { type TabSlots, createTabRow, useSlots } from './row'
import styles from './TabStrip.module.css'

export interface TabEntry {
  id: number
  label: string
  icon: IconName
  /** 同じワークスペースに並べているタブの数。2 つ以上なら、1 つにたたんで数を出す。 */
  count?: number
}

export interface TabStripProps {
  tabs: TabEntry[]
  current: number
  onSelect: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
  onAction?: (id: number, a: TabAction) => void
  /** 右クリックで出す項目。空なら出さない。 */
  actions?: (t: TabEntry) => TabAction[]
  /** id のタブを before の前に動かす。before がなければ末尾。 */
  onMove?: (id: number, before: number | undefined) => void
  /** id のタブを列の外へ運んでいるあいだ。位置は画面の上の位置で、列に戻ったら undefined。 */
  onDragAway?: (id: number, at: { x: number; y: number } | undefined) => void
  /** id のタブを列の外か窓の外で離したとき。位置は画面の上の位置。 */
  onDropAway?: (id: number, x: number, y: number) => void
  /** ほかの列から運んできたタブを受けられるようになったら、その受け口を渡す。なくなったら undefined。 */
  slots?: (s: TabSlots | undefined) => void
}

/** タイトルバーに並べるタブ。中クリックでも閉じる。 */
export function TabStrip(props: TabStripProps) {
  let list!: HTMLDivElement
  const row = createTabRow(props, 'x', () => list)
  useSlots(props, row)
  return (
    <div class={styles.root}>
      <div
        ref={list}
        class={styles.list}
        role="tablist"
        aria-label="タブ"
        data-dragging={row.dragging() !== undefined || undefined}
      >
        <Index each={props.tabs}>
          {(t, i) => <TabItem tab={t} index={i} row={row} tabs={props} classes={styles} axis="x" />}
        </Index>
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
