import { Index, Show } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { middleClick } from '../../nav/TabPane/newTab'
import { Thumb, type ThumbProps } from '../Thumb/Thumb'
import styles from './GroupCard.module.css'

export interface GroupCardProps {
  name: string
  count: number
  /** 重ねて見せる中身。先頭がいちばん手前で、3 件まで使う */
  faces: ThumbProps[]
  ratio?: number
  onClick?: () => void
}

/** 奥から順に描く */
const DEPTHS = [2, 1, 0] as const

/** グループを、中身のサムネイルを重ねた束として見せる。後ろの 2 枚は上の縁だけをのぞかせる。 */
export function GroupCard(props: GroupCardProps) {
  return (
    <button
      type="button"
      class={styles.root}
      style={{ '--ar': props.ratio ?? 1.25 }}
      onClick={() => props.onClick?.()}
      {...middleClick(() => props.onClick?.())}
    >
      <span class={styles.stack}>
        <Index each={DEPTHS}>
          {(d) => {
            const face = () => props.faces[d()]
            return (
              <Show when={face()}>
                {(f) => <Thumb {...f()} menu={false} class={`${styles.layer} ${styles[`d${d()}`]}`} />}
              </Show>
            )
          }}
        </Index>
      </span>
      <span class={styles.nm}>
        <Icon name="group" size={13} withText />
        <span class={styles.name}>{props.name}</span>
        <span class={styles.count}>{props.count} 件</span>
      </span>
    </button>
  )
}
