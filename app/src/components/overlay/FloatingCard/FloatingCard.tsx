import type { JSX } from 'solid-js'
import styles from './FloatingCard.module.css'
import { Icon } from '../../base/Icon/Icon'

export interface FloatingCardProps {
  title?: string
  onClose?: () => void
  children?: JSX.Element
}

export function FloatingCard(props: FloatingCardProps) {
  return (
    <section class={styles.root}>
      {props.title && (
        <header>
          <b>{props.title}</b>
          {props.onClose && (
            <button type="button" aria-label="閉じる" onClick={props.onClose}>
              <Icon name="close" size={14} />
            </button>
          )}
        </header>
      )}
      {props.children}
    </section>
  )
}
