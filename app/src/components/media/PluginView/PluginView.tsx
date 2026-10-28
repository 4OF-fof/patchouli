import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import { type UiApi, loadUi } from '../../../plugins/ui'
import styles from './PluginView.module.css'

export interface PluginViewProps {
  url: string
  api: UiApi
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
    loadUi(url)
      .then((mod) => {
        if (closed) return
        if (!mod.mount) throw new Error('詳細表示の関数（mount）が見つかりません')
        unmount = mod.mount(el, api) ?? undefined
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
