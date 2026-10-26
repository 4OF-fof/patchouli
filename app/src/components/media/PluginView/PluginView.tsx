import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import { type UiApi, loadUi } from '../../../plugins/ui'
import styles from './PluginView.module.css'

export interface PluginViewProps {
  /** 組み込み UI の ES モジュールの URL。 */
  url: string
  api: UiApi
  class?: string
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 組み込み UI の詳細の表示（mount）を、隔離せずに描く。中の素の要素には本体と同じ見た目を付ける。 */
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
