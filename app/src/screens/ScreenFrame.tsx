import type { JSX } from 'solid-js'
import styles from './ScreenFrame.module.css'

export interface ScreenFrameProps {
  bar?: JSX.Element
  toast?: JSX.Element
  children?: JSX.Element
}

export function ScreenFrame(props: ScreenFrameProps) {
  return (
    <div class={styles.root}>
      {props.bar}
      <div class={styles.body}>
        {props.children}
        {props.toast && <div class={styles.toast}>{props.toast}</div>}
      </div>
    </div>
  )
}
