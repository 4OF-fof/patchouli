import { Mosaic, type MosaicTile } from '../Mosaic/Mosaic'
import styles from './PinnedCard.module.css'

export interface PinnedCardProps {
  /** 例「秋の企画」「# 写真」。 */
  name: string
  /** 例「プロジェクト · 32 件」。 */
  meta?: string
  tiles: MosaicTile[]
  height?: number
  onClick?: () => void
}

/** 紙面のいちばん上に並べる、ピン留めしたプロジェクトやタグ。 */
export function PinnedCard(props: PinnedCardProps) {
  return (
    <button
      type="button"
      class={styles.root}
      style={{ '--mosaic-h': props.height ? `${props.height}px` : undefined }}
      onClick={() => props.onClick?.()}
    >
      <Mosaic tiles={props.tiles} />
      <span class={styles.t}>
        <b>{props.name}</b>
        {props.meta && <span>{props.meta}</span>}
      </span>
    </button>
  )
}
