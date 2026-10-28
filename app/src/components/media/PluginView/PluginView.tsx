import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import { type UiApi, loadUi } from '../../../plugins/ui'
import styles from './PluginView.module.css'

export interface PluginViewProps {
  url: string
  api: UiApi
  /** 描く関数。詳細は mount、ノートの埋め込みは embed */
  draw?: 'mount' | 'embed'
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PluginView(props: PluginViewProps) {
  let el!: HTMLDivElement
  const [error, setError] = createSignal<string>()
  let unmount: (() => void) | undefined
  let closed = false
  onMount(() => {
    const { url, api } = props
    const draw = props.draw ?? 'mount'
    loadUi(url)
      .then((mod) => {
        if (closed) return
        const fn = mod[draw]
        if (!fn) throw new Error(`${draw === 'mount' ? '詳細表示' : '埋め込み表示'}の関数（${draw}）が見つかりません`)
        unmount = fn(el, api) ?? undefined
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
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <div ref={el} class={styles.mount} />
      <Show when={error()}>
        <p class={styles.error} role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
