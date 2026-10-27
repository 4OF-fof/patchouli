import type { JSX } from 'solid-js'
import styles from './ScreenFrame.module.css'

export interface ScreenFrameProps {
  /** 上の段（タイトルバー）。 */
  bar?: JSX.Element
  /** 画面の上の中央に出す知らせ（Toast）。 */
  toast?: JSX.Element
  children?: JSX.Element
}

/** アプリの窓。上にタイトルバー、その下で画面が入れ替わり、知らせと重ねるものは画面の上に出す。 */
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
