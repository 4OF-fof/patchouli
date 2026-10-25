import { type JSX, splitProps } from 'solid-js'
import styles from './IconButton.module.css'

export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 読み上げと title に使う。 */
  label: string
  /** plain 地なし / float 浮かべる（カードの右上）。 */
  look?: 'plain' | 'float'
}

/** アイコンだけの丸いボタン。aria-pressed を渡すと、押している間は色が付く。 */
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ['label', 'look', 'class', 'children'])
  return (
    <button
      type="button"
      class={`${styles.root} ${local.class ?? ''}`}
      data-look={local.look ?? 'plain'}
      aria-label={local.label}
      title={local.label}
      {...rest}
    >
      {local.children}
    </button>
  )
}
