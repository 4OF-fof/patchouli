import type { JSX } from 'solid-js'
import styles from './JustifiedRow.module.css'

export interface JustifiedRowProps {
  /** 段の高さの目安（px）。幅に揃えるため、最後の段のほかは少し高くなる。 */
  height: number
  gap?: number
  /** 折り返さず 1 段に収める（はみ出した分は隠す）。 */
  singleLine?: boolean
  children?: JSX.Element
}

/** 高さをそろえて横に詰める段。ホームの「今週」「今月」「静かなもの」などに使う。 */
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
