import { type JSX, splitProps } from 'solid-js'
import styles from './Chip.module.css'

export interface ChipProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  dashed?: boolean
}

/** タグ。ラベルは # 付きで渡す（例「# 写真/旅行」）。 */
export function Chip(props: ChipProps) {
  const [local, rest] = splitProps(props, ['dashed', 'class', 'children'])
  return (
    <button type="button" class={`${styles.root} ${local.class ?? ''}`} data-dashed={local.dashed} {...rest}>
      {local.children}
    </button>
  )
}
