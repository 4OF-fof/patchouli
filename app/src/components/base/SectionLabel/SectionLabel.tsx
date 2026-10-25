import styles from './SectionLabel.module.css'

export interface SectionLabelProps {
  label: string
  count?: number
  /** 渡すと見出しごと押せる（例：プロジェクト名から開く）。 */
  onClick?: () => void
}

/** 段の上に置く小さな見出しと件数。 */
export function SectionLabel(props: SectionLabelProps) {
  const inner = () => (
    <>
      <b>{props.label}</b>
      {props.count != null && <em>{props.count}</em>}
    </>
  )
  return (
    <div class={styles.root}>
      {props.onClick ? (
        <button type="button" class={styles.btn} onClick={() => props.onClick?.()}>
          {inner()}
        </button>
      ) : (
        inner()
      )}
    </div>
  )
}
