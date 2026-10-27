import { For } from 'solid-js'
import { type Item, thumbOf } from '../../../model/library'
import { Thumb } from '../Thumb/Thumb'
import styles from './ThumbStrip.module.css'

export interface ThumbStripProps {
  items: Item[]
  overflow?: 'hide' | 'clip'
  onOpen?: (it: Item) => void
  class?: string
}

export function ThumbStrip(props: ThumbStripProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} data-overflow={props.overflow ?? 'hide'}>
      <For each={props.items}>
        {(it) =>
          props.onOpen ? (
            <button type="button" class={styles.cell} aria-label={it.name} onClick={() => props.onOpen?.(it)}>
              <Thumb {...thumbOf(it, 'X')} />
            </button>
          ) : (
            <Thumb {...thumbOf(it, 'X')} />
          )
        }
      </For>
    </div>
  )
}
