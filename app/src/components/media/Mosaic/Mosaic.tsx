import { For } from 'solid-js'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './Mosaic.module.css'

export type MosaicTile = Omit<ThumbProps, 'height' | 'class'>

export interface MosaicProps {
  tiles: MosaicTile[]
  count?: 3 | 5
  height?: number
  class?: string
}

export function Mosaic(props: MosaicProps) {
  return (
    <span
      class={`${styles.root} ${props.class ?? ''}`}
      data-count={props.count ?? 5}
      style={{ '--mosaic-h': props.height ? `${props.height}px` : undefined }}
    >
      <For each={props.tiles.slice(0, props.count ?? 5)}>{(t) => <Thumb {...t} class={styles.tile} />}</For>
    </span>
  )
}
