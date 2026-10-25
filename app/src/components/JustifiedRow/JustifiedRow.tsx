import type { JSX } from 'solid-js'
import styles from './JustifiedRow.module.css'

export interface JustifiedRowProps {
  /** 段の高さ（px）。中のカードは ratio に合わせて幅を分け合う。 */
  height: number
  gap?: number
  /** 折り返さず 1 段に収める（はみ出した分は隠す）。 */
  singleLine?: boolean
  children?: JSX.Element
}

/** 高さをそろえて横に詰める段。紙面の「今週」「今月」「静かなもの」などに使う。 */
export function JustifiedRow(props: JustifiedRowProps) {
  return (
    <div
      class={styles.root}
      data-one={props.singleLine}
      style={{ '--hh': `${props.height}px`, '--gap': `${props.gap ?? 8}px` }}
    >
      {props.children}
    </div>
  )
}
