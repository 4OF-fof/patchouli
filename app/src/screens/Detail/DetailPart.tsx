import type { JSX } from 'solid-js'
import styles from './DetailPart.module.css'

export interface DetailPartProps {
  label: JSX.Element
  /** 編集中は点線の枠にする。 */
  editing?: boolean
  /** 右上に重ねる操作（並べ替えのボタンなど）。 */
  controls?: JSX.Element
  /** 置き場所の側で中身の見た目を整えるとき。 */
  class?: string
  children?: JSX.Element
}

/** 詳細画面の左の列に積む、名前の付いた箱。 */
export function DetailPart(props: DetailPartProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} data-editing={props.editing}>
      {props.controls}
      <span class={styles.k}>{props.label}</span>
      {props.children}
    </div>
  )
}
