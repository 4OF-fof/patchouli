import { type JSX, splitProps } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import styles from './Checkbox.module.css'

export type CheckboxProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type'>

export function Checkbox(props: CheckboxProps) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <span class={`${styles.root} ${local.class ?? ''}`}>
      <input type="checkbox" class={styles.box} {...rest} />
      <Icon name="check" size={12} class={styles.mark} />
    </span>
  )
}
