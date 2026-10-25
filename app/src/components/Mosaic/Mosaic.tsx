import { For } from 'solid-js'
import styles from './Mosaic.module.css'

export interface MosaicTile {
  /** 色相 0–360。画像がないときの仮の絵に使う。 */
  hue?: number
  /** 彩度（%）。省略すると 28。 */
  sat?: number
  src?: string
}

export interface MosaicProps {
  /** 先頭が左の大きな枠、残り 4 つが右の小さな枠になる。5 つより多い分は使わない。 */
  tiles: MosaicTile[]
  height?: number
}

/** プロジェクトやタグの表紙。中身の素材を 5 つまで並べる。 */
export function Mosaic(props: MosaicProps) {
  return (
    <span class={styles.root} style={{ '--mosaic-h': props.height ? `${props.height}px` : undefined }}>
      <For each={props.tiles.slice(0, 5)}>
        {(t) => (
          <span
            style={{
              '--h': t.hue ?? 210,
              '--s': t.sat != null ? `${t.sat}%` : undefined,
              'background-image': t.src ? `url(${t.src})` : undefined,
            }}
          />
        )}
      </For>
    </span>
  )
}
