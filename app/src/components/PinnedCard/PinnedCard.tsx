import { Mosaic, type MosaicTile } from '../Mosaic/Mosaic'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './PinnedCard.module.css'

export interface PinnedCardProps {
  /** 例「秋の企画」「# 写真」。 */
  name: string
  /** 例「プロジェクト · 32 件」。 */
  meta?: string
  /** プロジェクトやタグの中身。 */
  tiles?: MosaicTile[]
  /** 素材 1 つを留めたとき。tiles の代わりにこの絵を出す。 */
  thumb?: ThumbProps
  height?: number
  onClick?: () => void
}

/** ホームのいちばん上に並べる、ピン留めしたプロジェクト・タグ・素材。 */
export function PinnedCard(props: PinnedCardProps) {
  return (
    <button
      type="button"
      class={styles.root}
      style={{ '--mosaic-h': props.height ? `${props.height}px` : undefined }}
      onClick={() => props.onClick?.()}
    >
      {props.thumb ? <Thumb {...props.thumb} class={styles.th} /> : <Mosaic tiles={props.tiles ?? []} />}
      <span class={styles.t}>
        <b>{props.name}</b>
        {props.meta && <span>{props.meta}</span>}
      </span>
    </button>
  )
}
