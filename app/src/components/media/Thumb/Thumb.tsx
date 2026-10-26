import type { Fit } from '../../../plugins/types'
import styles from './Thumb.module.css'

export interface ThumbProps {
  /** ノート。名前と本文の書き出しを出す。 */
  note?: boolean
  /** 色相 0–360。画像がないときの仮の絵に使う。 */
  hue?: number
  /** 彩度（%）。省略すると 28。 */
  sat?: number
  src?: string
  /** 枠と縦横比が合わない src の収め方。省略すると center。 */
  fit?: Fit
  title?: string
  excerpt?: string
  height?: number
  selected?: boolean
  /** 保存していない変更がある（右上に点）。 */
  dirty?: boolean
  /** 置き場所の側で大きさなどを整えるとき。 */
  class?: string
}

export function Thumb(props: ThumbProps) {
  return (
    <span
      class={`${styles.root} ${props.class ?? ''}`}
      data-note={!!props.note}
      data-fit={props.src ? (props.fit ?? 'center') : undefined}
      data-selected={props.selected}
      style={{
        '--h': props.hue ?? 210,
        '--s': props.sat != null ? `${props.sat}%` : undefined,
        height: props.height ? `${props.height}px` : undefined,
        'background-image': props.src ? `url(${props.src})` : undefined,
      }}
    >
      {props.note && (
        <>
          {props.title && <b>{props.title}</b>}
          {props.excerpt}
        </>
      )}
      {props.dirty && <span class={styles.dirty} title="未保存" />}
    </span>
  )
}
