import { type JSX, createEffect } from 'solid-js'
import { Kbd } from '../../base/Kbd/Kbd'
import { Thumb, type ThumbProps } from '../../media/Thumb/Thumb'
import styles from './ResultRow.module.css'

/** command 操作 / project プロジェクト / note ノート / asset 素材 / create 「〜という名前でノートを作る」 */
export type ResultKind = 'command' | 'project' | 'note' | 'asset' | 'create'

export interface ResultRowProps {
  kind: ResultKind
  /** 一致したところは <mark> で囲む。 */
  title: JSX.Element
  sub?: JSX.Element
  kbd?: string
  /** 素材のときの絵。 */
  thumb?: ThumbProps
  selected?: boolean
  onClick?: () => void
}

const ICON: Record<Exclude<ResultKind, 'asset'>, string> = {
  command: '›',
  project: 'PJ',
  note: '▤',
  create: '＋',
}

/** 検索バーの結果の 1 行。 */
export function ResultRow(props: ResultRowProps) {
  let el!: HTMLDivElement
  createEffect(() => {
    if (props.selected) el.scrollIntoView({ block: 'nearest' })
  })
  return (
    // キー操作は検索欄の ↑↓ Enter が受け持つ（combobox）ので、行はマウスで押せるだけにする
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      ref={el}
      class={styles.root}
      role="option"
      tabIndex={-1}
      data-kind={props.kind}
      aria-selected={!!props.selected}
      onClick={() => props.onClick?.()}
    >
      <span class={styles.ic}>
        {props.kind === 'asset' ? <Thumb {...props.thumb} class={styles.thumb} /> : ICON[props.kind]}
      </span>
      <span class={styles.tx}>
        <b>{props.title}</b>
        {props.sub && <span>{props.sub}</span>}
      </span>
      {props.kbd && <Kbd>{props.kbd}</Kbd>}
    </div>
  )
}

/** 結果のまとまりの見出し（「操作」「プロジェクト」「項目」）。 */
export function ResultHeading(props: { children: JSX.Element }) {
  return <div class={styles.sec}>{props.children}</div>
}
