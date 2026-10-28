import { Show } from 'solid-js'
import { Thumb, type ThumbProps } from '../../media/Thumb/Thumb'
import styles from './QuickView.module.css'

export interface QuickViewProps {
  /** リンク先の名前。見つからないときは undefined。 */
  name?: string
  id: string
  /** ノート・素材の形式など。 */
  kind?: string
  /** ノートの本文の書き出し。 */
  text?: string
  /** 素材のサムネイル。 */
  thumb?: ThumbProps
  left: number
  top: number
}

/** リンク先の中身を小さく見せる。 */
export function QuickView(props: QuickViewProps) {
  const left = () => Math.max(8, Math.min(props.left, window.innerWidth - 336))
  return (
    <div class={styles.root} role="tooltip" style={{ left: `${left()}px`, top: `${props.top}px` }}>
      <Show
        when={props.name !== undefined}
        fallback={
          <div class={styles.missing}>
            リンク先が見つかりません <span class={styles.id}>{props.id}</span>
          </div>
        }
      >
        <div class={styles.head}>
          <span class={styles.name}>{props.name}</span>
          <Show when={props.kind}>
            <span class={styles.kind}>{props.kind}</span>
          </Show>
        </div>
        <Show when={props.text !== undefined}>
          <p class={styles.text}>{props.text || 'まだ本文がありません'}</p>
        </Show>
        <Show when={props.thumb}>{(t) => <Thumb {...t()} fit="contain" height={180} />}</Show>
      </Show>
      <span class={styles.hint}>Ctrl+クリックで開く</span>
    </div>
  )
}
