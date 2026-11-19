import { type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useHost } from '../../../window/host'
import { coverPage } from '../../media/WebPage/layer'
import styles from './ContextMenu.module.css'
import { usePopover } from '../usePopover'

export interface ContextMenuProps {
  x: number
  y: number
  /** メニューを開いたボタン。押しても外側として閉じず、ボタンのほうで開け閉めする。 */
  anchor?: Element
  onClose: () => void
  children: JSX.Element
}

const MARGIN = 8

/** 右クリックした場所に出す層。画面からはみ出すときは、内側に寄せる。 */
export function ContextMenu(props: ContextMenuProps) {
  let el!: HTMLDivElement
  const host = useHost()()
  const [pos, setPos] = createSignal({ left: props.x, top: props.y })
  const place = () => {
    const r = el.getBoundingClientRect()
    const { innerWidth, innerHeight } = host.win
    const left = props.x + r.width + MARGIN > innerWidth ? Math.max(MARGIN, props.x - r.width) : props.x
    const top = props.y + r.height + MARGIN > innerHeight ? Math.max(MARGIN, innerHeight - r.height - MARGIN) : props.y
    setPos({ left, top })
  }
  const close = () => props.onClose()
  usePopover({ pop: () => el, anchor: () => props.anchor, onClose: close })
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  }
  onMount(() => {
    const ro = new ResizeObserver(place)
    ro.observe(el)
    const w = host.win
    w.addEventListener('keydown', onKey, true)
    w.addEventListener('resize', close)
    w.addEventListener('blur', close)
    onCleanup(() => {
      ro.disconnect()
      w.removeEventListener('keydown', onKey, true)
      w.removeEventListener('resize', close)
      w.removeEventListener('blur', close)
    })
  })
  return (
    <Portal mount={host.doc.body}>
      <div
        ref={(e) => {
          el = e
          if (host.main) coverPage(e)
        }}
        class={styles.root}
        style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {props.children}
      </div>
    </Portal>
  )
}
