import { type JSX, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import styles from './Peek.module.css'

export interface PeekProps {
  label: string
  onExpand?: () => void
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
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={panel} class={styles.panel} role="dialog" aria-label={props.label} tabIndex={-1}>
        {props.children}
      </div>
      <div class={styles.tools}>
        {props.onExpand && (
          <button type="button" data-tip="全画面表示" aria-label="全画面表示" onClick={() => props.onExpand?.()}>
            <Icon name="fullscreen" size={16} />
          </button>
        )}
        <button type="button" data-tip="閉じる" aria-label="閉じる" onClick={() => props.onClose()}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
