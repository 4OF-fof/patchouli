import styles from './ProgressBar.module.css'

export interface ProgressBarProps {
  /** 0〜1。 */
  value: number
  /** 置き場所の側で幅などを決めるとき。 */
  class?: string
}

/** 細い進み具合の棒。 */
export function ProgressBar(props: ProgressBarProps) {
  return (
    <span class={`${styles.root} ${props.class ?? ''}`}>
      <span style={{ width: `${Math.min(1, Math.max(0, props.value || 0)) * 100}%` }} />
    </span>
  )
}
