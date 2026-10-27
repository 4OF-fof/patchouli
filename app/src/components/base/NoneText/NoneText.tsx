import type { JSX } from 'solid-js'
import styles from './NoneText.module.css'

export function NoneText(props: { children: JSX.Element }) {
  return <span class={styles.root}>{props.children}</span>
}
