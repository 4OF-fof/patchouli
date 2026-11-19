import type { JSX } from 'solid-js'
import styles from './Kbd.module.css'

export function Kbd(props: { children: JSX.Element; class?: string }) {
  return <kbd class={`${styles.root} ${props.class ?? ''}`}>{props.children}</kbd>
}
