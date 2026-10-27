import type { JSX } from 'solid-js'
import styles from './LinkRow.module.css'

export interface LinkRowProps {
  mark?: string
  label: JSX.Element
  sub?: string
  current?: boolean
  missing?: boolean
  indent?: boolean
  onClick?: () => void
}

export function LinkRow(props: LinkRowProps) {
  return (
    <button
      type="button"
      class={styles.root}
      data-current={props.current}
      data-missing={props.missing}
      data-indent={props.indent}
      onClick={() => props.onClick?.()}
    >
      {props.mark && <em>{props.mark}</em>}
      <span>{props.label}</span>
      {props.sub && <small>{props.sub}</small>}
    </button>
  )
}

export function LinkCaption(props: { children: JSX.Element }) {
  return <div class={styles.cap}>{props.children}</div>
}

export function LinkNone(props: { children: JSX.Element }) {
  return <div class={styles.none}>{props.children}</div>
}
