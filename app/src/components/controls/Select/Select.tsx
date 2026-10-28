import { For, Show, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Icon } from '../../base/Icon/Icon'
import styles from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  value: string
  options: SelectOption[]
  onChange?: (value: string) => void
  id?: string
  'aria-label'?: string
  disabled?: boolean
  class?: string
}

/** 一覧から 1 つを選ぶ。一覧は画面の上に浮かべるので、スクロールする枠の中に置いても切れない。 */
export function Select(props: SelectProps) {
  const listId = createUniqueId()
  let button!: HTMLButtonElement
  let list: HTMLDivElement | undefined
  const [open, setOpen] = createSignal(false)
  const [at, setAt] = createSignal(0)
  const [pos, setPos] = createSignal({ left: 0, top: 0, width: 0, up: false })
  const index = () => props.options.findIndex((o) => o.value === props.value)
  const current = () => props.options[index()]

  const place = () => {
    const r = button.getBoundingClientRect()
    const up = r.bottom + 260 > window.innerHeight && r.top > window.innerHeight - r.bottom
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up })
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
    if (t instanceof Node && !list?.contains(t) && !button.contains(t)) close(false)
  }
  const onMove = (e: Event) => {
    if (e.type === 'scroll' && e.target instanceof Node && list?.contains(e.target)) return
    close(false)
  }
  const show = () => {
    if (props.disabled || open()) return
    place()
    setAt(Math.max(0, index()))
    setOpen(true)
    window.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    queueMicrotask(() => {
      list?.focus()
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    })
  }
  onCleanup(() => close(false))

  const choose = (i: number) => {
    const o = props.options[i]
    close()
    if (o && o.value !== props.value) props.onChange?.(o.value)
  }
  const move = (i: number) => {
    const n = props.options.length
    if (!n) return
    setAt(Math.min(n - 1, Math.max(0, i)))
    list?.querySelector(`[data-index="${at()}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const onListKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(at() + 1),
      ArrowUp: () => move(at() - 1),
      Home: () => move(0),
      End: () => move(props.options.length - 1),
      Enter: () => choose(at()),
      ' ': () => choose(at()),
      Escape: () => close(),
      Tab: () => close(),
    }
    const run = keys[e.key]
    if (!run) return
    // Esc で画面を戻さない
    e.stopPropagation()
    if (e.key !== 'Tab') e.preventDefault()
    run()
  }
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    show()
  }

  return (
    <>
      <button
        ref={button}
        id={props.id}
        type="button"
        class={`${styles.root} ${props.class ?? ''}`}
        aria-label={props['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? listId : undefined}
        disabled={props.disabled}
        onClick={() => (open() ? close() : show())}
        onKeyDown={onButtonKey}
      >
        <span class={styles.value}>{current()?.label ?? ''}</span>
        <Icon name="chevron" size={12} class={styles.chevron} />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={list}
            id={listId}
            class={styles.list}
            role="listbox"
            tabIndex={-1}
            aria-label={props['aria-label']}
            aria-activedescendant={`${listId}-${at()}`}
            data-up={pos().up}
            style={{ left: `${pos().left}px`, top: `${pos().top}px`, 'min-width': `${pos().width}px` }}
            onKeyDown={onListKey}
          >
            <For each={props.options}>
              {(o, i) => (
                // キー操作は一覧が受け持つので、行はマウスで押せるだけにする
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  id={`${listId}-${i()}`}
                  class={styles.option}
                  role="option"
                  tabIndex={-1}
                  data-index={i()}
                  data-active={i() === at()}
                  aria-selected={o.value === props.value}
                  onPointerEnter={() => setAt(i())}
                  onClick={() => choose(i())}
                >
                  <span>{o.label}</span>
                  <Show when={o.value === props.value}>
                    <Icon name="check" size={12} />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  )
}
