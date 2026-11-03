import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { LinkApi, ScreenApi } from '../../../../plugins/sdk'
import { type UiApi, loadUi } from '../../../plugins/ui'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { SelectList } from '../../controls/Select/Select'
import styles from './PluginView.module.css'

export type PluginViewProps = {
  url: string
  /** 描く関数。詳細は mount、ノートの埋め込みは embed */
  draw?: 'mount' | 'embed'
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
} & (
  | { api: UiApi; link?: false; screen?: undefined }
  /** links の関数で、URL を描く */
  | { api: LinkApi; link: true; screen?: undefined }
  /** screens の mount で、画面を描く */
  | { api: ScreenApi; link?: false; screen: string }
)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 素の select が一覧を開くキー。 */
const OPEN_KEYS = new Set([' ', 'Enter', 'F4'])

const optionsOf = (s: HTMLSelectElement) =>
  [...s.options].filter((o) => !o.disabled && !o.hidden).map((o) => ({ value: o.value, label: o.label }))

export function PluginView(props: PluginViewProps) {
  let root!: HTMLDivElement
  let el!: HTMLDivElement
  const [error, setError] = createSignal<string>()
  // プラグインが描いた素の select は、OS の一覧の代わりに本体の一覧で開く。値と input・change は素の select と同じに扱う
  const [picking, setPicking] = createSignal<HTMLSelectElement>()
  const selectOf = (t: EventTarget | null) => {
    const s = t instanceof Element ? t.closest('select') : null
    return s && el.contains(s) && !s.multiple && s.size <= 1 && !s.disabled ? s : undefined
  }
  const onSelectDown = (e: MouseEvent) => {
    const s = e.button === 0 ? selectOf(e.target) : undefined
    if (!s) return
    e.preventDefault()
    s.focus()
    setPicking(picking() === s ? undefined : s)
  }
  const onSelectKey = (e: KeyboardEvent) => {
    const s = selectOf(e.target)
    const opens = OPEN_KEYS.has(e.key) || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))
    if (!s || !opens) return
    e.preventDefault()
    setPicking(s)
  }
  const choose = (s: HTMLSelectElement, value: string) => {
    setPicking(undefined)
    s.focus()
    if (value === s.value) return
    s.value = value
    s.dispatchEvent(new Event('input', { bubbles: true }))
    s.dispatchEvent(new Event('change', { bubbles: true }))
  }
  onMount(() => {
    root.addEventListener('mousedown', onSelectDown, true)
    root.addEventListener('keydown', onSelectKey, true)
  })
  let unmount: (() => void) | undefined
  let closed = false
  onMount(() => {
    const draw = props.draw ?? 'mount'
    const what = draw === 'mount' ? '詳細表示' : '埋め込み表示'
    loadUi(props.url)
      .then((mod) => {
        if (closed) return
        if (props.screen !== undefined) {
          const screen = mod.screens?.[props.screen]
          if (!screen) throw new Error(`画面の関数（screens.${props.screen}.mount）が見つかりません`)
          unmount = screen.mount(el, props.api) ?? undefined
          return
        }
        if (props.link) {
          const fn = mod.links?.[draw]
          if (!fn) throw new Error(`URL の${what}の関数（links.${draw}）が見つかりません`)
          unmount = fn(el, props.api) ?? undefined
          return
        }
        const fn = mod[draw]
        if (!fn) throw new Error(`${what}の関数（${draw}）が見つかりません`)
        unmount = fn(el, props.api) ?? undefined
      })
      .catch((e: unknown) => setError(`プラグインの表示に失敗しました：${message(e)}`))
      .finally(() => closed || props.onReady?.())
  })
  onCleanup(() => {
    closed = true
    try {
      unmount?.()
    } catch (e) {
      console.warn('プラグインの表示を閉じられない', e)
    }
  })
  return (
    <div ref={root} class={`${styles.root} ${props.class ?? ''}`}>
      {/* 埋め込みは中身の高さで並べるので、本文のスクロールを止めないよう送る枠にしない */}
      <Show when={props.draw === 'embed'} fallback={<ScrollArea ref={el} class={styles.mount} />}>
        <div ref={el} class={styles.mount} />
      </Show>
      <Show when={error()}>
        <p class={styles.error} role="alert">
          {error()}
        </p>
      </Show>
      <Show when={picking()} keyed>
        {(s) => (
          <SelectList
            anchor={s}
            value={s.value}
            options={optionsOf(s)}
            aria-label={s.getAttribute('aria-label') ?? s.labels?.[0]?.textContent ?? undefined}
            onChoose={(v) => choose(s, v)}
            onClose={(focus) => {
              setPicking(undefined)
              if (focus) s.focus()
            }}
          />
        )}
      </Show>
    </div>
  )
}
