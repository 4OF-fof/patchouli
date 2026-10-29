import { type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './ContextMenu.module.css'

export interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  children: JSX.Element
}

const MARGIN = 8

/** 右クリックした場所に出す層。画面からはみ出すときは、内側に寄せる。 */
export function ContextMenu(props: ContextMenuProps) {
  let el!: HTMLDivElement
  const [pos, setPos] = createSignal({ left: props.x, top: props.y })
  const place = () => {
    const r = el.getBoundingClientRect()
    const left = props.x + r.width + MARGIN > innerWidth ? Math.max(MARGIN, props.x - r.width) : props.x
    const top = props.y + r.height + MARGIN > innerHeight ? Math.max(MARGIN, innerHeight - r.height - MARGIN) : props.y
    setPos({ left, top })
  }
  const close = () => props.onClose()
  const onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && !el.contains(e.target)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  }
  onMount(() => {
    const ro = new ResizeObserver(place)
    ro.observe(el)
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    onCleanup(() => {
      ro.disconnect()
      document.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    })
  })
  return (
    <Portal>
      <div
        ref={el}
        class={styles.root}
        style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {props.children}
      </div>
    </Portal>
  )
}
