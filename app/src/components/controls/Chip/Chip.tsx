import { type JSX, splitProps } from 'solid-js'
import styles from './Chip.module.css'

export interface ChipProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  dashed?: boolean
}

export function Chip(props: ChipProps) {
  const [local, rest] = splitProps(props, ['dashed', 'class', 'children'])
  return (
    <button type="button" class={`${styles.root} ${local.class ?? ''}`} data-dashed={local.dashed} {...rest}>
      {local.children}
    </button>
  )
}
