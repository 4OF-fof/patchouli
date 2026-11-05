import type { JSX } from 'solid-js'
import styles from './Stage.module.css'

/**
 * 1 つの窓の、タブの画面を並べる面。タブの画面は窓のあいだを動くので、あとからこの中に入れる。
 * Solid は描くものが空になると親の中身をまとめて消すので、重ねるものは別の箱に入れ、あとから入れた画面を巻き込まないようにする。
 */
export function Stage(props: { ref: (el: HTMLDivElement) => void; children?: JSX.Element }) {
  return (
    <div ref={props.ref} class={styles.root}>
      <div class={styles.layers}>{props.children}</div>
    </div>
  )
}
