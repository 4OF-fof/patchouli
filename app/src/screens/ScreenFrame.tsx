import { children, type JSX } from 'solid-js'
import styles from './ScreenFrame.module.css'

export interface ScreenFrameProps {
  bar?: JSX.Element
  /** 本文の左に置くもの（縦のタブなど）。 */
  side?: JSX.Element
  toast?: JSX.Element
  children?: JSX.Element
}

export function ScreenFrame(props: ScreenFrameProps) {
  const toast = children(() => props.toast)
  return (
    <div class={styles.root}>
      {props.bar}
      <div class={styles.main}>
        {props.side}
        <div class={styles.body}>
          {props.children}
          {toast.toArray().some(Boolean) && <div class={styles.toast}>{toast()}</div>}
        </div>
      </div>
    </div>
  )
}
