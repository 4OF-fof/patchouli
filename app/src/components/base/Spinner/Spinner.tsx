import styles from './Spinner.module.css'

export interface SpinnerProps {
  size?: number
  class?: string
}

export function Spinner(props: SpinnerProps) {
  return (
    <span
      class={`${styles.root} ${props.class ?? ''}`}
      style={{ '--spinner-size': `${props.size ?? 14}px` }}
      aria-hidden="true"
    />
  )
}
