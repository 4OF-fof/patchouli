import { Icon } from '../Icon/Icon'
import { IconButton } from '../IconButton/IconButton'

export interface PinToggleProps {
  pressed?: boolean
  /** 何に留めるか（例「ホームに」）。読み上げと title に使う。 */
  where?: string
  /** plain 地なし（タグ一覧・プロジェクト一覧）/ float 浮かべる（カードの右上）。 */
  look?: 'plain' | 'float'
  /** 置き場所の側で位置を決めるとき。 */
  class?: string
  onClick?: () => void
}

/** ピン留めの切り替え。 */
export function PinToggle(props: PinToggleProps) {
  return (
    <IconButton
      class={props.class}
      look={props.look}
      label={`${props.where ?? ''}ピン留め${props.pressed ? 'を外す' : 'する'}`}
      aria-pressed={!!props.pressed}
      onClick={() => props.onClick?.()}
    >
      <Icon name="pin" />
    </IconButton>
  )
}
