import { For, Show } from 'solid-js'
import styles from './AddPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface AddPartProps<T extends string> {
  parts: { type: T; label: string; note: string }[]
  open?: boolean
  onToggle?: () => void
  onPick?: (type: T) => void
}

export function AddPart<T extends string>(props: AddPartProps<T>) {
  return (
    <>
      <button type="button" class={styles.add} aria-expanded={!!props.open} onClick={() => props.onToggle?.()}>
        <Icon name="plus" size={14} withText />
        セクションを追加
      </button>
      <Show when={props.open}>
        <div class={styles.menu}>
          <For each={props.parts}>
            {(p) => (
              <button type="button" onClick={() => props.onPick?.(p.type)}>
                <span>{p.label}</span>
                <small>{p.note}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}
