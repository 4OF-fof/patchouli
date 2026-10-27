import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import styles from './PinToggle.module.css'

export interface PinToggleProps {
  pressed?: boolean
  /** 何に留めるか（例「ホームに」）。読み上げと title に使う。 */
  where?: string
  /** plain 地なし（タグ一覧・プロジェクト一覧）/ float 浮かべる（カードの右上）。 */
  look?: 'plain' | 'float'
  /** 留めていない間は隠し、置き場所の側が --pin-show を 1 にしたときだけ出す（カードのホバーなど）。 */
  reveal?: boolean
  /** 置き場所の側で位置を決めるとき。 */
  class?: string
  onClick?: () => void
}

/** ピン留めの切り替え。 */
export function PinToggle(props: PinToggleProps) {
  return (
    <IconButton
      class={`${styles.pin} ${props.reveal ? styles.reveal : ''} ${props.class ?? ''}`}
      look={props.look}
      label={props.pressed ? 'ピン留めを解除' : `${props.where ?? ''}ピン留めする`}
      aria-pressed={!!props.pressed}
      onClick={() => props.onClick?.()}
    >
      <Icon name="pin" class={styles.glyph} />
    </IconButton>
  )
}
