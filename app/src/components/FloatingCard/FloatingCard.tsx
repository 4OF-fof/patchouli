import type { JSX } from 'solid-js'
import styles from './FloatingCard.module.css'

export interface FloatingCardProps {
  title?: string
  onClose?: () => void
  children?: JSX.Element
}

/** ノートの見出し・つながり、素材の情報など、画面の端に浮かべるカード。 */
export function FloatingCard(props: FloatingCardProps) {
  return (
    <section class={styles.root}>
      {props.title && (
        <header>
          <b>{props.title}</b>
          {props.onClose && (
            <button type="button" aria-label="閉じる" onClick={props.onClose}>
              ✕
            </button>
          )}
        </header>
      )}
      {props.children}
    </section>
  )
}
