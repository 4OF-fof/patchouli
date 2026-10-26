import styles from './DropZone.module.css'

export interface DropZoneProps {
  /** 例「12 件のファイルを取り込む」。 */
  title: string
  /** 例「離すと取り込み、自動分類の確認に回ります」。 */
  sub?: string
}

/** ファイルを持ってきたときに画面いっぱいに出す受け口。置き場所の要素に position: relative を付けておく。 */
export function DropZone(props: DropZoneProps) {
  // 外側で下の画面への操作（スクロールなど）を受け止める
  return (
    <div class={styles.root}>
      <div class={styles.box} aria-live="polite">
        <b>{props.title}</b>
        {props.sub && <span>{props.sub}</span>}
      </div>
    </div>
  )
}
