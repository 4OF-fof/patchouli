import { type JSX, Show } from 'solid-js'
import styles from './QuickView.module.css'

export type QuickMedia =
  | { kind: 'image' | 'video' | 'audio'; src: string }
  | { kind: 'card'; thumb?: string }
  | { kind: 'text'; text: string }

export interface QuickViewProps {
  /** リンク先の名前。見つからないときは undefined。 */
  name?: string
  id: string
  /** ノート・素材の形式など。 */
  kind?: string
  media?: QuickMedia
  left: number
  top: number
  /** 下に添える操作。 */
  children?: JSX.Element
}

function body(m: QuickMedia) {
  if (m.kind === 'image') return <img class={styles.media} src={m.src} alt="" />
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- 音を消した見本の再生
  if (m.kind === 'video') return <video class={styles.media} src={m.src} muted autoplay loop playsinline />
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材の音声
  if (m.kind === 'audio') return <audio class={styles.audio} src={m.src} controls preload="metadata" />
  if (m.kind === 'card') return m.thumb ? <img class={styles.media} src={m.thumb} alt="" /> : null
  return 'text' in m ? <p class={styles.text}>{m.text || 'まだ本文がありません'}</p> : null
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
        <Show when={props.media} keyed>
          {(m) => body(m)}
        </Show>
      </Show>
      <div class={styles.foot}>
        {props.children}
        <span class={styles.hint}>Ctrl+クリックで開く</span>
      </div>
    </div>
  )
}
