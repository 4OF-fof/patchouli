import styles from './DropZone.module.css'

export interface DropZoneProps {
  title: string
  sub?: string
}

export function DropZone(props: DropZoneProps) {
  return (
    <div class={styles.root}>
      <div class={styles.box} aria-live="polite">
        <b>{props.title}</b>
        {props.sub && <span>{props.sub}</span>}
      </div>
    </div>
  )
}
