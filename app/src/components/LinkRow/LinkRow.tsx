import type { JSX } from 'solid-js'
import styles from './LinkRow.module.css'

export interface LinkRowProps {
  /** 左の印（← → など）。 */
  mark?: string
  label: JSX.Element
  /** 右に小さく出す（「ノート」「素材」「未作成」）。 */
  sub?: string
  /** いま見ているところ（見出しの現在地）。 */
  current?: boolean
  /** まだないノートへのリンク。 */
  missing?: boolean
  /** 左を下げる（見出しの 2 段目）。 */
  indent?: boolean
  onClick?: () => void
}

/** 見出し・つながり・情報のカードに並べる 1 行。 */
export function LinkRow(props: LinkRowProps) {
  return (
    <button
      type="button"
      class={styles.root}
      data-current={props.current}
      data-missing={props.missing}
      data-indent={props.indent}
      onClick={() => props.onClick?.()}
    >
      {props.mark && <em>{props.mark}</em>}
      <span>{props.label}</span>
      {props.sub && <small>{props.sub}</small>}
    </button>
  )
}

/** カードの中のまとまりの見出し（「このノートへ」）。 */
export function LinkCaption(props: { children: JSX.Element }) {
  return <div class={styles.cap}>{props.children}</div>
}

/** まだ何もないときの一言。 */
export function LinkNone(props: { children: JSX.Element }) {
  return <div class={styles.none}>{props.children}</div>
}
