import type { JSX } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { FloatingPill } from '../../controls/FloatingPill/FloatingPill'
import styles from './TopBar.module.css'

export interface TopBarProps {
  class?: string
  children?: JSX.Element
  actions?: JSX.Element
}

export function TopBar(props: TopBarProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      {props.children}
      <span class={styles.sp} />
      {props.actions}
      <FloatingPill icon aria-label="その他">
        <Icon name="more" />
      </FloatingPill>
    </div>
  )
}
