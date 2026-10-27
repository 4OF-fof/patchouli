import styles from './ProgressBar.module.css'

export interface ProgressBarProps {
  value: number
  class?: string
}

export function ProgressBar(props: ProgressBarProps) {
  return (
    <span class={`${styles.root} ${props.class ?? ''}`}>
      <span style={{ width: `${Math.min(1, Math.max(0, props.value || 0)) * 100}%` }} />
    </span>
  )
}
