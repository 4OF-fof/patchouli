import type { JSX } from 'solid-js'
import styles from './JustifiedRow.module.css'

export interface JustifiedRowProps {
  height: number
  gap?: number
  singleLine?: boolean
  children?: JSX.Element
}

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
