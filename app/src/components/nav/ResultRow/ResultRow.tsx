import { type JSX, createEffect } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { Kbd } from '../../base/Kbd/Kbd'
import { Thumb, type ThumbProps } from '../../media/Thumb/Thumb'
import styles from './ResultRow.module.css'

export type ResultKind = 'command' | 'project' | 'note' | 'asset' | 'create'

export interface ResultRowProps {
  kind: ResultKind
  title: JSX.Element
  sub?: JSX.Element
  kbd?: string
  thumb?: ThumbProps
  selected?: boolean
  onClick?: () => void
}

const ICON: Record<Exclude<ResultKind, 'asset'>, IconName> = {
  command: 'chevron',
  project: 'folder',
  note: 'note',
  create: 'plus',
}

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
        {props.kind === 'asset' ? <Thumb {...props.thumb} class={styles.thumb} /> : <Icon name={ICON[props.kind]} />}
      </span>
      <span class={styles.tx}>
        <b>{props.title}</b>
        {props.sub && <span>{props.sub}</span>}
      </span>
      {props.kbd && <Kbd>{props.kbd}</Kbd>}
    </div>
  )
}

export function ResultHeading(props: { children: JSX.Element }) {
  return <div class={styles.sec}>{props.children}</div>
}
