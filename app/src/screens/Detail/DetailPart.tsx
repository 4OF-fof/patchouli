import type { JSX } from 'solid-js'
import styles from './DetailPart.module.css'

export interface DetailPartProps {
  label: JSX.Element
  /** 編集中は点線の枠にし、右上に並べ替えと外すボタンを出す。 */
  editing?: boolean
  /** 置き場所の側で中身の見た目を整えるとき。 */
  class?: string
  children?: JSX.Element
}

/** 詳細画面の左の列に積む、名前の付いた箱。 */
export function DetailPart(props: DetailPartProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} data-editing={props.editing}>
      {props.editing && (
        <span class={styles.ctl}>
          <button type="button" aria-label="上へ">
            ↑
          </button>
          <button type="button" aria-label="下へ">
            ↓
          </button>
          <button type="button" class={styles.del} aria-label="外す">
            ✕
          </button>
        </span>
      )}
      <span class={styles.k}>{props.label}</span>
      {props.children}
    </div>
  )
}
