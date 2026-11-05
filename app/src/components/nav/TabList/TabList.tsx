import { Index, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { TabMenu } from '../TabMenu/TabMenu'
import type { TabStripProps } from '../TabStrip/TabStrip'
import { TabItem } from '../TabStrip/TabItem'
import { createTabRow, useSlots } from '../TabStrip/row'
import styles from './TabList.module.css'

/** カーソルが窓の左端に来たときに出す幅（px）。 */
const EDGE = 4
/** 列からカーソルが離れてから隠すまで（ms）。斜めに抜けたときにすぐ消えないようにする */
const HIDE_DELAY = 250

/** 窓の左端にカーソルを寄せると浮かび上がる、縦に並べたタブ。中クリックでも閉じる。 */
export function TabList(props: TabStripProps) {
  let root!: HTMLDivElement
  let list!: HTMLDivElement
  const [open, setOpen] = createSignal(false)
  const row = createTabRow(props, 'y', () => list)
  useSlots(props, row)
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
      data-open={open() || !!row.menu() || row.dragging() !== undefined || row.receiving()}
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
      <div
        ref={list}
        class={styles.list}
        role="tablist"
        aria-label="タブ"
        aria-orientation="vertical"
        data-dragging={row.dragging() !== undefined || undefined}
      >
        <Index each={props.tabs}>
          {(t, i) => <TabItem tab={t} index={i} row={row} tabs={props} classes={styles} axis="y" />}
        </Index>
      </div>
      <Show when={row.menu()} keyed>
        {(m) => (
          <TabMenu
            x={m.x}
            y={m.y}
            actions={m.actions}
            onAction={(a) => props.onAction?.(m.id, a)}
            onClose={() => row.setMenu(undefined)}
          />
        )}
      </Show>
    </div>
  )
}
