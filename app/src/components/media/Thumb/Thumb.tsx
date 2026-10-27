import { createContext, useContext } from 'solid-js'
import type { Fit } from '../../../plugins/types'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './Thumb.module.css'

const Making = createContext<(id: string) => boolean>(() => false)

/** 素材の id を受け、裏でその素材のサムネイルを作っているあいだ true を返す関数を渡す。 */
export const ThumbMakingProvider = Making.Provider

export interface ThumbProps {
  /** ノート。名前と本文の書き出しを出す。 */
  note?: boolean
  /** 色相 0–360。画像がないときの仮の絵に使う。 */
  hue?: number
  /** 彩度（%）。省略すると 28。 */
  sat?: number
  src?: string
  /** 素材の id。src がなく、この素材のサムネイルを裏で作っているあいだは、回る印を出す。 */
  id?: string
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
  const making = useContext(Making)
  const waiting = () => !props.src && !props.note && !!props.id && making(props.id)
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
      {waiting() && <Spinner class={styles.making} />}
      {props.dirty && <span class={styles.dirty} title="未保存" />}
    </span>
  )
}
