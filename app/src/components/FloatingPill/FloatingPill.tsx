import { type JSX, splitProps } from 'solid-js'
import { Kbd } from '../Kbd/Kbd'
import styles from './FloatingPill.module.css'

export interface FloatingPillProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** キー表示（例「Ctrl P」）。 */
  kbd?: string
  /** 件数（例「見出し 4」の 4）。 */
  count?: number
}

/** 画面の上に浮かべる丸いボタン。 */
export function FloatingPill(props: FloatingPillProps) {
  const [local, rest] = splitProps(props, ['kbd', 'count', 'class', 'children'])
  return (
    <button type="button" class={`${styles.root} ${local.class ?? ''}`} {...rest}>
      {local.children}
      {local.count != null && <b class={styles.count}>{local.count}</b>}
      {local.kbd && <Kbd>{local.kbd}</Kbd>}
    </button>
  )
}
