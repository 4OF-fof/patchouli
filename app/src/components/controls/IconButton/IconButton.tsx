import { type JSX, splitProps } from 'solid-js'
import styles from './IconButton.module.css'

export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  look?: 'plain' | 'float'
}

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
