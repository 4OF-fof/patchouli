import { type JSX, splitProps } from 'solid-js'
import styles from './Button.module.css'

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  pressed?: boolean
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'pressed', 'class', 'children'])
  return (
    <button
      type="button"
      class={`${styles.root} ${local.class ?? ''}`}
      data-variant={local.variant ?? 'default'}
      data-size={local.size ?? 'md'}
      aria-pressed={local.pressed}
      {...rest}
    >
      {local.children}
    </button>
  )
}
