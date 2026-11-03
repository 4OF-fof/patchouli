import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { LinkApi } from '../../../../plugins/sdk'
import { type UiApi, loadUi } from '../../../plugins/ui'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import styles from './PluginView.module.css'

export type PluginViewProps = {
  url: string
  /** 描く関数。詳細は mount、ノートの埋め込みは embed */
  draw?: 'mount' | 'embed'
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
} & (
  | { api: UiApi; link?: false }
  /** links の関数で、URL を描く */
  | { api: LinkApi; link: true }
)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PluginView(props: PluginViewProps) {
  let el!: HTMLDivElement
  const [error, setError] = createSignal<string>()
  let unmount: (() => void) | undefined
  let closed = false
  onMount(() => {
    const draw = props.draw ?? 'mount'
    const what = draw === 'mount' ? '詳細表示' : '埋め込み表示'
    loadUi(props.url)
      .then((mod) => {
        if (closed) return
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
    <div class={`${styles.root} ${props.class ?? ''}`}>
      {/* 埋め込みは中身の高さで並べるので、本文のスクロールを止めないよう送る枠にしない */}
      <Show when={props.draw === 'embed'} fallback={<ScrollArea ref={el} class={styles.mount} />}>
        <div ref={el} class={styles.mount} />
      </Show>
      <Show when={error()}>
        <p class={styles.error} role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
