import { type JSX, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { coverPage } from '../../media/WebPage/layer'
import type { SplitSide } from '../../nav/SplitView/split'
import styles from './Peek.module.css'

export interface PeekProps {
  label: string
  onExpand?: () => void
  /** あれば、分割して横か下に開くボタンを出す。 */
  onSplit?: (side: SplitSide) => void
  /** あれば、既定のブラウザで開くボタンを一番下に出す。 */
  onOpenDefault?: () => void
  onClose: () => void
  children?: JSX.Element
}

export function Peek(props: PeekProps) {
  let panel!: HTMLDivElement
  // 中の入力欄や一覧が Esc を使ったときは閉じない
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
    e.preventDefault()
    props.onClose()
  }
  onMount(() => {
    panel.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))
  return (
    <div
      ref={coverPage}
      class={styles.ov}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div ref={panel} class={styles.panel} role="dialog" aria-label={props.label} tabIndex={-1}>
        {props.children}
      </div>
      <div class={styles.tools}>
        <button type="button" data-tip="閉じる" aria-label="閉じる" onClick={() => props.onClose()}>
          <Icon name="close" size={16} />
        </button>
        {props.onExpand && (
          <button
            type="button"
            data-tip="新しいタブで開く"
            aria-label="新しいタブで開く"
            onClick={() => props.onExpand?.()}
          >
            <Icon name="fullscreen" size={16} />
          </button>
        )}
        {props.onSplit && (
          <>
            <button type="button" data-tip="右に分割" aria-label="右に分割" onClick={() => props.onSplit?.('right')}>
              <Icon name="splitRight" size={16} />
            </button>
            <button type="button" data-tip="下に分割" aria-label="下に分割" onClick={() => props.onSplit?.('down')}>
              <Icon name="splitDown" size={16} />
            </button>
          </>
        )}
        {props.onOpenDefault && (
          <button
            type="button"
            data-tip="既定のブラウザで開く"
            aria-label="既定のブラウザで開く"
            onClick={() => props.onOpenDefault?.()}
          >
            <Icon name="external" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
