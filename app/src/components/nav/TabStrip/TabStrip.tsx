import { Index, createEffect } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import styles from './TabStrip.module.css'

export interface TabEntry {
  id: number
  label: string
  icon: IconName
}

export interface TabStripProps {
  tabs: TabEntry[]
  current: number
  onSelect: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
}

/** タイトルバーに並べるタブ。中クリックでも閉じる。 */
export function TabStrip(props: TabStripProps) {
  return (
    <div class={styles.root}>
      <div class={styles.list} role="tablist" aria-label="タブ">
        <Index each={props.tabs}>
          {(t) => {
            let el!: HTMLDivElement
            const current = () => t().id === props.current
            createEffect(() => {
              if (current()) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            })
            return (
              <div ref={el} class={styles.tab} data-current={current()}>
                <button
                  type="button"
                  role="tab"
                  class={styles.main}
                  aria-selected={current()}
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
                  <Icon name="close" size={12} />
                </button>
              </div>
            )
          }}
        </Index>
      </div>
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
