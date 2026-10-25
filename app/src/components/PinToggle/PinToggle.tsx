import styles from './PinToggle.module.css'

export interface PinToggleProps {
  pressed?: boolean
  /** 何に留めるか（例「紙面に」）。読み上げと title に使う。 */
  where?: string
  /** plain 地なし（タグ一覧・プロジェクト一覧）/ float 浮かべる（カードの右上）。 */
  look?: 'plain' | 'float'
  /** 置き場所の側で位置を決めるとき。 */
  class?: string
  onClick?: () => void
}

/** ピン留めの切り替え。 */
export function PinToggle(props: PinToggleProps) {
  const label = () => `${props.where ?? ''}ピン留め${props.pressed ? 'を外す' : 'する'}`
  return (
    <button
      type="button"
      class={`${styles.root} ${props.class ?? ''}`}
      data-look={props.look ?? 'plain'}
      aria-pressed={!!props.pressed}
      aria-label={label()}
      title={label()}
      onClick={() => props.onClick?.()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10.2 1.5 14.5 5.8 13.4 6.9 12.6 6.5 9.9 9.2 10.3 12.3 9.2 13.4 6.5 10.7 2.7 14.5 1.5 13.3 5.3 9.5 2.6 6.8 3.7 5.7 6.8 6.1 9.5 3.4 9.1 2.6z"
        />
      </svg>
    </button>
  )
}
