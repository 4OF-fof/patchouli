import { For, Show, createSignal, createUniqueId, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Icon } from '../../base/Icon/Icon'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import styles from './Select.module.css'
import { usePopover } from '../../overlay/usePopover'

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
  const [open, setOpen] = createSignal(false)
  const current = () => props.options.find((o) => o.value === props.value)
  const close = (focus: boolean) => {
    setOpen(false)
    if (focus) button.focus()
  }
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (!props.disabled) setOpen(true)
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
        onClick={() => (open() ? close(true) : setOpen(true))}
        onKeyDown={onButtonKey}
      >
        <span class={styles.value}>{current()?.label ?? ''}</span>
        <Icon name={open() ? 'chevronUp' : 'chevronDown'} size={12} class={styles.chevron} withText />
      </button>
      <Show when={open()}>
        <SelectList
          id={listId}
          anchor={button}
          value={props.value}
          options={props.options}
          aria-label={props['aria-label']}
          onChoose={(v) => {
            close(true)
            if (v !== props.value) props.onChange?.(v)
          }}
          onClose={close}
        />
      </Show>
    </>
  )
}

export interface SelectListProps {
  /** 一覧を添える要素。この下（入らなければ上）に出し、押しても外を押したことにしない。 */
  anchor: HTMLElement
  value: string
  options: SelectOption[]
  id?: string
  'aria-label'?: string
  onChoose: (value: string) => void
  /** focus は、anchor にフォーカスを戻すか。外を押したときや、画面が動いたときは戻さない。 */
  onClose: (focus: boolean) => void
}

/** Select の一覧。出したときにフォーカスを受け取り、選ぶか閉じるまでキー操作を受け持つ。 */
export function SelectList(props: SelectListProps) {
  const fallbackId = createUniqueId()
  const listId = () => props.id ?? fallbackId
  let list!: HTMLDivElement
  const index = () => props.options.findIndex((o) => o.value === props.value)
  const [at, setAt] = createSignal(Math.max(0, index()))
  const r = props.anchor.getBoundingClientRect()
  const up = r.bottom + 260 > window.innerHeight && r.top > window.innerHeight - r.bottom
  const pos = { left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up }

  usePopover({ pop: () => list, anchor: () => props.anchor, onClose: () => props.onClose(false), move: true })
  onMount(() => {
    list.focus()
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  })

  const choose = (i: number) => {
    const o = props.options[i]
    if (o) props.onChoose(o.value)
    else props.onClose(true)
  }
  const move = (i: number) => {
    const n = props.options.length
    if (!n) return
    setAt(Math.min(n - 1, Math.max(0, i)))
    list.querySelector(`[data-index="${at()}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const onListKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(at() + 1),
      ArrowUp: () => move(at() - 1),
      Home: () => move(0),
      End: () => move(props.options.length - 1),
      Enter: () => choose(at()),
      ' ': () => choose(at()),
      Escape: () => props.onClose(true),
      Tab: () => props.onClose(true),
    }
    const run = keys[e.key]
    if (!run) return
    // Esc で外側を閉じない
    e.stopPropagation()
    if (e.key !== 'Tab') e.preventDefault()
    run()
  }

  return (
    <Portal>
      <div
        ref={list}
        id={listId()}
        class={styles.list}
        role="listbox"
        tabIndex={-1}
        aria-label={props['aria-label']}
        aria-activedescendant={`${listId()}-${at()}`}
        data-up={pos.up}
        style={{ left: `${pos.left}px`, top: `${pos.top}px`, 'min-width': `${pos.width}px` }}
        onKeyDown={onListKey}
      >
        <ScrollArea class={styles.scroll} viewClass={styles.options}>
          <For each={props.options}>
            {(o, i) => (
              // キー操作は一覧が受け持つので、行はマウスで押せるだけにする
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                id={`${listId()}-${i()}`}
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
                  <Icon name="check" size={12} withText />
                </Show>
              </div>
            )}
          </For>
        </ScrollArea>
      </div>
    </Portal>
  )
}
