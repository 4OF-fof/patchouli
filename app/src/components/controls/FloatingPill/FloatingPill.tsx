import { type JSX, splitProps } from 'solid-js'
import { Kbd } from '../../base/Kbd/Kbd'
import styles from './FloatingPill.module.css'

export interface FloatingPillProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  kbd?: string
  count?: number
  icon?: boolean
}

export function FloatingPill(props: FloatingPillProps) {
  const [local, rest] = splitProps(props, ['kbd', 'count', 'icon', 'class', 'children'])
  return (
    <button type="button" class={`${styles.root} ${local.class ?? ''}`} data-icon={local.icon} {...rest}>
      {local.children}
      {local.count != null && <b class={styles.count}>{local.count}</b>}
      {local.kbd && <Kbd>{local.kbd}</Kbd>}
    </button>
  )
}

export function FloatingLabel(props: { class?: string; children?: JSX.Element }) {
  return (
    <span class={`${styles.root} ${props.class ?? ''}`} data-static>
      {props.children}
    </span>
  )
}
