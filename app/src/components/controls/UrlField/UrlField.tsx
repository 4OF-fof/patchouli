import { Show, createEffect, createSignal } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import styles from './UrlField.module.css'

export interface UrlFieldProps {
  value?: string
  /** 空にしたときは '' を渡す。 */
  onChange: (url: string) => void
  onOpen?: (url: string) => void
  /** 空にできないもの（ショートカットのリンク先など）。空にしたら元に戻す。 */
  required?: boolean
  'aria-label'?: string
  class?: string
}

const isWeb = (s: string) => /^https?:\/\//i.test(s)

/** 項目の URL。Enter か離れたときに確定し、Esc では元に戻す。 */
export function UrlField(props: UrlFieldProps) {
  let el!: HTMLInputElement
  const [text, setText] = createSignal(props.value ?? '')
  createEffect(() => {
    const v = props.value ?? ''
    if (document.activeElement !== el) {
      el.value = v
      setText(v)
    }
  })
  const commit = () => {
    const v = el.value.trim()
    const now = props.value ?? ''
    if (v === now || (!v && props.required)) {
      el.value = now
      setText(now)
      return
    }
    el.value = v
    props.onChange(v)
  }
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <input
        ref={el}
        class={styles.input}
        type="text"
        inputmode="url"
        spellcheck={false}
        placeholder="URL を入力"
        aria-label={props['aria-label'] ?? 'URL'}
        onInput={(e) => setText(e.currentTarget.value.trim())}
        onKeyDown={(e) => {
          if (e.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            el.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            el.value = props.value ?? ''
            setText(el.value)
            el.blur()
          }
        }}
        onBlur={commit}
      />
      <Show when={props.onOpen && isWeb(text())}>
        <IconButton class={styles.open} label="URL を開く" onClick={() => props.onOpen?.(text())}>
          <Icon name="external" size={14} />
        </IconButton>
      </Show>
    </div>
  )
}
