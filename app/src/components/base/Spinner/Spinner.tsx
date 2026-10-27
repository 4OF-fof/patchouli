import styles from './Spinner.module.css'

export interface SpinnerProps {
  /** 一辺の大きさ（px）。既定は 14。 */
  size?: number
  class?: string
}

/** 処理中の印。線の輪の一部を回す。読み上げでは無視する。 */
export function Spinner(props: SpinnerProps) {
  return (
    <span
      class={`${styles.root} ${props.class ?? ''}`}
      style={{ '--spinner-size': `${props.size ?? 14}px` }}
      aria-hidden="true"
    />
  )
}
