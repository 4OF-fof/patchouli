import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { TabMenu } from '../TabMenu/TabMenu'
import type { TabEntry, TabStripProps } from '../TabStrip/TabStrip'
import { createTabUnits, faceOf } from '../TabStrip/units'
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
  const u = createTabUnits(props, 'y', () => list)
  const seg = (t: () => TabEntry) => (
    <div class={styles.seg} data-current={t().id === props.current} onContextMenu={(e) => u.openMenu(t(), e)}>
      <button
        type="button"
        role="tab"
        class={styles.main}
        aria-selected={t().id === props.current}
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
        <Icon name="close" size={14} />
      </button>
    </div>
  )
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
      data-open={open() || !!u.menu() || u.dragging() !== undefined}
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
        data-dragging={u.dragging() !== undefined || undefined}
      >
        <Index each={u.units()}>
          {(g, i) => {
            let el!: HTMLDivElement
            const current = () => g().tabs.some((t) => t.id === props.current)
            const folded = () => g().group && !current()
            const face = () => faceOf(g())
            createEffect(() => {
              if (current()) el.scrollIntoView({ block: 'nearest' })
            })
            return (
              <div
                ref={el}
                class={styles.tab}
                data-unit
                data-current={current()}
                data-group={g().group ? (folded() ? 'folded' : 'open') : undefined}
                style={{ transform: u.shift(i) }}
                data-dragged={u.dragging() === i || undefined}
                onPointerDown={(e) => u.startDrag(i, e)}
              >
                <Show when={folded()} fallback={<Index each={g().tabs}>{seg}</Index>}>
                  <div class={styles.seg}>
                    <button
                      type="button"
                      role="tab"
                      class={styles.main}
                      aria-selected={false}
                      data-tip={g()
                        .tabs.map((t) => t.label)
                        .join('、')}
                      onClick={() => {
                        const f = face()
                        if (f) props.onSelect(f.id)
                      }}
                      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                      onAuxClick={(e) => e.button === 1 && u.closeAll(g())}
                    >
                      <Icon name="splitRight" size={14} />
                      <span class={styles.label}>{face()?.label}</span>
                      <span class={styles.count}>{g().tabs.length}</span>
                    </button>
                    <button
                      type="button"
                      class={styles.close}
                      aria-label={`「${face()?.label ?? ''}」など ${g().tabs.length} 件のタブを閉じる`}
                      onClick={() => u.closeAll(g())}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </Show>
              </div>
            )
          }}
        </Index>
      </div>
      <Show when={u.menu()} keyed>
        {(m) => (
          <TabMenu
            x={m.x}
            y={m.y}
            actions={m.actions}
            onAction={(a) => props.onAction?.(m.id, a)}
            onClose={() => u.setMenu(undefined)}
          />
        )}
      </Show>
    </div>
  )
}
