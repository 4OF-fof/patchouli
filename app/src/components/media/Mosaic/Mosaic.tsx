import { For } from 'solid-js'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './Mosaic.module.css'

/** 1 枠の絵。Thumb に渡す値で、大きさは枠が決める。 */
export type MosaicTile = Omit<ThumbProps, 'height' | 'class'>

export interface MosaicProps {
  /** 先頭が左の大きな枠、残りが右の小さな枠になる。count より多い分は使わない。 */
  tiles: MosaicTile[]
  /** 枠の数。5 は右に 2×2、3 は右に縦 2 つ。どちらも枠は 4:3 になる。 */
  count?: 3 | 5
  height?: number
  class?: string
}

/** プロジェクトやタグの表紙。中身の素材を 5 つまで並べる。 */
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
