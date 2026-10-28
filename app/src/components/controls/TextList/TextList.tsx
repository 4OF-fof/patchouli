import { For, Show, createSignal } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import styles from './TextList.module.css'

export interface TextListProps {
  values: string[]
  onChange: (values: string[]) => void
  /** 1 行の名前。読み上げと削除のボタンに使う。 */
  name: string
  /** 足せないもの（空・重複のほか）。 */
  reject?: (value: string) => boolean
  class?: string
}

/** 文字を 1 行に 1 つずつ並べ、書き換え・追加・削除ができる一覧。Enter か離れたときに確定する。 */
export function TextList(props: TextListProps) {
  let root!: HTMLDivElement
  const [adding, setAdding] = createSignal(false)
  const ok = (v: string, except?: number) =>
    !!v && !props.values.some((x, i) => x === v && i !== except) && !props.reject?.(v)

  const commit = (i: number, el: HTMLInputElement) => {
    const v = el.value.trim()
    const now = props.values[i]
    if (now === undefined || v === now) return
    if (!v) return props.onChange(props.values.filter((_, k) => k !== i))
    if (!ok(v, i)) {
      el.value = now
      return
    }
    props.onChange(props.values.map((x, k) => (k === i ? v : x)))
  }
  const add = (el: HTMLInputElement) => {
    const v = el.value.trim()
    el.value = ''
    if (ok(v)) props.onChange([...props.values, v])
  }
  const focusRow = (i: number) => root.querySelectorAll<HTMLInputElement>('input')[i]?.focus()
  const onRowKey = (e: KeyboardEvent & { currentTarget: HTMLInputElement }, i: number) => {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(i, e.currentTarget)
      if (i + 1 < props.values.length) focusRow(i + 1)
      else setAdding(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.value = props.values[i] ?? ''
      e.currentTarget.blur()
    }
  }
  const onAddKey = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      add(e.currentTarget)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.value = ''
      setAdding(false)
    } else if (e.key === 'Backspace' && !e.currentTarget.value && props.values.length) {
      e.preventDefault()
      setAdding(false)
      focusRow(props.values.length - 1)
    }
  }

  return (
    <div ref={root} class={`${styles.root} ${props.class ?? ''}`}>
      <For each={props.values}>
        {(v, i) => (
          <div class={styles.row}>
            <input
              type="text"
              class={styles.input}
              value={v}
              aria-label={`${props.name} ${i() + 1}`}
              onKeyDown={(e) => onRowKey(e, i())}
              onBlur={(e) => commit(i(), e.currentTarget)}
            />
            <IconButton
              class={styles.remove}
              label={`${props.name}「${v}」を削除`}
              onClick={() => props.onChange(props.values.filter((_, k) => k !== i()))}
            >
              <Icon name="close" size={12} />
            </IconButton>
          </div>
        )}
      </For>
      <Show
        when={adding()}
        fallback={
          <Button class={styles.add} variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} class={styles.plus} />
            追加
          </Button>
        }
      >
        <div class={styles.row}>
          <input
            ref={(el) => queueMicrotask(() => el.focus())}
            type="text"
            class={styles.input}
            placeholder={`${props.name}を入力`}
            aria-label={`${props.name}を追加`}
            onKeyDown={onAddKey}
            onBlur={(e) => {
              add(e.currentTarget)
              setAdding(false)
            }}
          />
        </div>
      </Show>
    </div>
  )
}
