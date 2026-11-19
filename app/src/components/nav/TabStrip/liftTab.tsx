import { createRoot } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import type { TabEntry } from './TabStrip'
import { type DragHandlers, liftWith } from './row'
import styles from './ghost.module.css'

/** タブの列の外（パンくずの段の何もないところなど）を押して、tab のタブを運ぶ。写しは、タブと同じくアイコンと名前で描く。 */
export function liftTab(e: PointerEvent, tab: TabEntry, h: Required<Pick<DragHandlers, 'onAway' | 'onDropAway'>>) {
  liftWith(
    e,
    () =>
      createRoot((dispose) => {
        const el = (
          <div class={styles.tab}>
            <Icon name={tab.icon} size={14} />
            <span>{tab.label}</span>
          </div>
        )
        dispose()
        return el instanceof HTMLElement ? el : undefined
      }),
    h,
  )
}
