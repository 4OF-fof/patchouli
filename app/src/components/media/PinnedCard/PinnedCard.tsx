import { Mosaic, type MosaicTile } from '../Mosaic/Mosaic'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './PinnedCard.module.css'

export interface PinnedCardProps {
  name: string
  meta?: string
  tiles?: MosaicTile[]
  thumb?: ThumbProps
  height?: number
  large?: boolean
  class?: string
  onClick?: () => void
}

export function PinnedCard(props: PinnedCardProps) {
  return (
    <button
      type="button"
      class={`${styles.root} ${props.class ?? ''}`}
      data-large={props.large || undefined}
      style={{ '--mosaic-h': props.height ? `${props.height}px` : undefined }}
      onClick={() => props.onClick?.()}
    >
      {props.thumb ? (
        <Thumb {...props.thumb} menu={false} class={`${styles.cover} ${styles.th}`} />
      ) : (
        <Mosaic tiles={props.tiles ?? []} count={props.large ? 5 : 3} class={styles.cover} />
      )}
      <span class={styles.t}>
        <b>{props.name}</b>
        {props.meta && <span>{props.meta}</span>}
      </span>
    </button>
  )
}
