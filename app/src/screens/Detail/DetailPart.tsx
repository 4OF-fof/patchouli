import type { JSX } from 'solid-js'
import styles from './DetailPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'

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
          <button type="button" aria-label="上へ移動">
            <Icon name="up" size={14} />
          </button>
          <button type="button" aria-label="下へ移動">
            <Icon name="down" size={14} />
          </button>
          <button type="button" class={styles.del} aria-label="削除">
            <Icon name="close" size={14} />
          </button>
        </span>
      )}
      <span class={styles.k}>{props.label}</span>
      {props.children}
    </div>
  )
}
