import { For } from 'solid-js'
import { type Item, thumbOf } from '../../../model/library'
import { Thumb } from '../Thumb/Thumb'
import styles from './ThumbStrip.module.css'

export interface ThumbStripProps {
  items: Item[]
  /** hide 入りきらない枠は出さない / clip 右端まで並べ、はみ出た枠は途中で切る。 */
  overflow?: 'hide' | 'clip'
  /** 渡すと、枠ごとに押せる。 */
  onOpen?: (it: Item) => void
  /** 置き場所の側で幅や --thumb-h（枠の高さ）を決めるとき。 */
  class?: string
}

/** 4:3 の小さな枠を 1 行に並べた帯。 */
export function ThumbStrip(props: ThumbStripProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} data-overflow={props.overflow ?? 'hide'}>
      <For each={props.items}>
        {(it) =>
          props.onOpen ? (
            <button
              type="button"
              class={styles.cell}
              title={it.name}
              aria-label={it.name}
              onClick={() => props.onOpen?.(it)}
            >
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
