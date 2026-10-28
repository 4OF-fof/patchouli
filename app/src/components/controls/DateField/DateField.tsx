import { For, Show, createSignal, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Icon } from '../../base/Icon/Icon'
import styles from './DateField.module.css'

export interface DateFieldProps {
  /** YYYY-MM-DD。空なら未設定 */
  value: string
  onChange?: (value: string) => void
  today?: Date
  placeholder?: string
  id?: string
  'aria-label'?: string
  disabled?: boolean
  class?: string
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last))
}

/** 日付を 1 つ選ぶ。カレンダーは画面の上に浮かべるので、スクロールする枠の中に置いても切れない。 */
export function DateField(props: DateFieldProps) {
  let button!: HTMLButtonElement
  let pop: HTMLDivElement | undefined
  const [open, setOpen] = createSignal(false)
  const [at, setAt] = createSignal(new Date())
  const [pos, setPos] = createSignal({ left: 0, top: 0, up: false })
  const today = () => props.today ?? new Date()
  const value = () => parse(props.value)

  const days = () => {
    const a = at()
    const first = new Date(a.getFullYear(), a.getMonth(), 1)
    const start = addDays(first, -first.getDay())
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }
  const focusAt = () =>
    queueMicrotask(() => pop?.querySelector<HTMLButtonElement>(`[data-day="${iso(at())}"]`)?.focus())
  const move = (d: Date) => {
    setAt(d)
    focusAt()
  }

  const place = () => {
    const r = button.getBoundingClientRect()
    const up = r.bottom + 320 > window.innerHeight && r.top > window.innerHeight - r.bottom
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up })
  }
  const close = (focus = true) => {
    setOpen(false)
    window.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('resize', onMove)
    window.removeEventListener('scroll', onMove, true)
    if (focus) button.focus()
  }
  const onOutside = (e: PointerEvent) => {
    const t = e.target
    if (t instanceof Node && !pop?.contains(t) && !button.contains(t)) close(false)
  }
  const onMove = (e: Event) => {
    if (e.type === 'scroll' && e.target instanceof Node && pop?.contains(e.target)) return
    close(false)
  }
  const show = () => {
    if (props.disabled || open()) return
    place()
    setAt(value() ?? today())
    setOpen(true)
    window.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    focusAt()
  }
  onCleanup(() => close(false))

  const choose = (d: Date | undefined) => {
    close()
    const v = d ? iso(d) : ''
    if (v !== props.value) props.onChange?.(v)
  }
  const onKey = (e: KeyboardEvent) => {
    const a = at()
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(addDays(a, -1)),
      ArrowRight: () => move(addDays(a, 1)),
      ArrowUp: () => move(addDays(a, -7)),
      ArrowDown: () => move(addDays(a, 7)),
      PageUp: () => move(addMonths(a, -1)),
      PageDown: () => move(addMonths(a, 1)),
      Escape: () => close(),
    }
    const run = keys[e.key]
    if (!run) return
    // Esc で外側を閉じない
    e.stopPropagation()
    e.preventDefault()
    run()
  }

  return (
    <>
      <button
        ref={button}
        id={props.id}
        type="button"
        class={`${styles.root} ${props.class ?? ''}`}
        aria-label={props['aria-label']}
        aria-haspopup="dialog"
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={() => (open() ? close() : show())}
      >
        <span class={styles.value} data-empty={!value()}>
          {value() ? props.value.replaceAll('-', '/') : (props.placeholder ?? '日付を選択')}
        </span>
        <Icon name="calendar" size={12} class={styles.icon} withText />
      </button>
      <Show when={open()}>
        <Portal>
          {/* 矢印キーと Esc は、月の切り替えボタンにいるときもカレンダー全体で受ける */}
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            ref={pop}
            class={styles.pop}
            role="dialog"
            aria-label={props['aria-label'] ?? '日付を選択'}
            data-up={pos().up}
            style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
            onKeyDown={onKey}
          >
            <div class={styles.head}>
              <b>
                {at().getFullYear()}年{at().getMonth() + 1}月
              </b>
              <button
                type="button"
                class={styles.nav}
                aria-label="前の月"
                data-tip="前の月"
                onClick={() => move(addMonths(at(), -1))}
              >
                <Icon name="back" size={14} />
              </button>
              <button
                type="button"
                class={styles.nav}
                aria-label="次の月"
                data-tip="次の月"
                onClick={() => move(addMonths(at(), 1))}
              >
                <Icon name="chevron" size={14} />
              </button>
            </div>
            <div class={styles.grid} role="grid">
              <For each={WEEK}>{(w) => <span class={styles.week}>{w}</span>}</For>
              <For each={days()}>
                {(d) => (
                  <button
                    type="button"
                    class={styles.day}
                    data-day={iso(d)}
                    data-out={d.getMonth() !== at().getMonth()}
                    data-today={iso(d) === iso(today())}
                    aria-pressed={iso(d) === props.value}
                    tabIndex={iso(d) === iso(at()) ? 0 : -1}
                    onClick={() => choose(d)}
                  >
                    {d.getDate()}
                  </button>
                )}
              </For>
            </div>
            <div class={styles.foot}>
              <button type="button" onClick={() => choose(today())}>
                今日
              </button>
              <Show when={value()}>
                <button type="button" onClick={() => choose(undefined)}>
                  削除
                </button>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  )
}
