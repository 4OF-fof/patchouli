import { Index, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import type { TabStripProps } from '../TabStrip/TabStrip'
import styles from './TabList.module.css'

/** カーソルが窓の左端に来たときに出す幅（px）。 */
const EDGE = 4
/** 列からカーソルが離れてから隠すまで（ms）。斜めに抜けたときにすぐ消えないようにする */
const HIDE_DELAY = 250

/** 窓の左端にカーソルを寄せると浮かび上がる、縦に並べたタブ。中クリックでも閉じる。 */
export function TabList(props: TabStripProps) {
  let root!: HTMLDivElement
  const [open, setOpen] = createSignal(false)
  let inside = false
  let timer = 0
  const show = () => {
    clearTimeout(timer)
    timer = 0
    setOpen(true)
  }
  const hide = () => {
    timer ||= window.setTimeout(() => {
      timer = 0
      setOpen(false)
    }, HIDE_DELAY)
  }
  // 左端に寄せたら出し、列に入らずに右へ離れたら隠す
  const onMove = (e: PointerEvent) => {
    if (inside) return
    const r = root.getBoundingClientRect()
    if (e.clientX <= EDGE && e.clientY >= r.top && e.clientY <= r.bottom) show()
    else if (open() && e.clientX > r.right) hide()
  }
  onMount(() => document.addEventListener('pointermove', onMove, { passive: true }))
  onCleanup(() => {
    document.removeEventListener('pointermove', onMove)
    clearTimeout(timer)
  })
  return (
    <div
      ref={root}
      class={styles.root}
      data-open={open()}
      onPointerEnter={() => {
        inside = true
        show()
      }}
      onPointerLeave={() => {
        inside = false
        hide()
      }}
    >
      <button type="button" class={styles.add} onClick={() => props.onNew()}>
        <Icon name="plus" size={14} />
        <span class={styles.label}>新しいタブ</span>
      </button>
      <div class={styles.list} role="tablist" aria-label="タブ" aria-orientation="vertical">
        <Index each={props.tabs}>
          {(t) => {
            let el!: HTMLDivElement
            const current = () => t().id === props.current
            createEffect(() => {
              if (current()) el.scrollIntoView({ block: 'nearest' })
            })
            return (
              <div ref={el} class={styles.tab} data-current={current()}>
                <button
                  type="button"
                  role="tab"
                  class={styles.main}
                  aria-selected={current()}
                  data-tip={t().label}
                  onClick={() => props.onSelect(t().id)}
                  onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                  onAuxClick={(e) => e.button === 1 && props.onClose(t().id)}
                >
                  <Icon name={t().icon} size={14} />
                  <span class={styles.label}>{t().label}</span>
                </button>
                <button
                  type="button"
                  class={styles.close}
                  aria-label={`「${t().label}」を閉じる`}
                  onClick={() => props.onClose(t().id)}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            )
          }}
        </Index>
      </div>
    </div>
  )
}
