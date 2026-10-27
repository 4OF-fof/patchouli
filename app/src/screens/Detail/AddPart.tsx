import { For, Show } from 'solid-js'
import styles from './AddPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface AddPartProps {
  /** 足せる部品の名前と短い説明。 */
  parts: { label: string; note: string }[]
  open?: boolean
  onToggle?: () => void
}

/** 表紙の編集中に出す「＋ 部品を足す」と、その一覧。 */
export function AddPart(props: AddPartProps) {
  return (
    <>
      <button type="button" class={styles.add} aria-expanded={!!props.open} onClick={() => props.onToggle?.()}>
        <Icon name="plus" size={14} />
        セクションを追加
      </button>
      <Show when={props.open}>
        <div class={styles.menu}>
          <For each={props.parts}>
            {(p) => (
              <button type="button">
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
