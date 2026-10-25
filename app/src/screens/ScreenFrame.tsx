import type { JSX } from 'solid-js'
import styles from './ScreenFrame.module.css'

export interface ScreenFrameProps {
  /** 画面の上の中央に出す知らせ（Toast）。 */
  toast?: JSX.Element
  children?: JSX.Element
}

/** アプリの窓。画面はこの中で入れ替わり、検索バー・知らせ・重ねるものは上に浮かぶ。 */
export function ScreenFrame(props: ScreenFrameProps) {
  return (
    <div class={styles.root}>
      {props.children}
      {props.toast && <div class={styles.toast}>{props.toast}</div>}
    </div>
  )
}
