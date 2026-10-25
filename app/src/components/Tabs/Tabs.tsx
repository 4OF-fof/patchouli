import { For } from 'solid-js'
import styles from './Tabs.module.css'

export interface TabsProps<K extends string> {
  /** 読み上げ用の名前（例「並べ方」）。 */
  label: string
  items: { key: K; label: string }[]
  value: K
  onChange?: (key: K) => void
}

/** 並べ方などを切り替える、横に並んだ小さなタブ。 */
export function Tabs<K extends string>(props: TabsProps<K>) {
  return (
    <div class={styles.root} role="tablist" aria-label={props.label}>
      <For each={props.items}>
        {(it) => (
          <button
            type="button"
            role="tab"
            aria-selected={it.key === props.value}
            onClick={() => props.onChange?.(it.key)}
          >
            {it.label}
          </button>
        )}
      </For>
    </div>
  )
}
