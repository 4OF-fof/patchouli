import styles from './SectionLabel.module.css'

export interface SectionLabelProps {
  label: string
  count?: number
  onClick?: () => void
}

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
