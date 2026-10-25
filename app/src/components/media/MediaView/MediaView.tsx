import { Match, Switch } from 'solid-js'
import styles from './MediaView.module.css'

export interface MediaViewProps {
  kind: 'image' | 'video' | 'audio'
  /** 中身の URL。 */
  src: string
  /** サムネイルの URL。動画の最初の絵と、音声のジャケットにする。 */
  thumb?: string
  name: string
  /** 置き場所の側で大きさを決めるとき。 */
  class?: string
}

/** 素材の中身。プラグインが「画像・動画・音声として出す」と決めたものを、本体が描く。 */
export function MediaView(props: MediaViewProps) {
  return (
    <Switch>
      <Match when={props.kind === 'image'}>
        <img class={`${styles.media} ${props.class ?? ''}`} src={props.src} alt={props.name} />
      </Match>
      <Match when={props.kind === 'video'}>
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
        <video
          class={`${styles.media} ${styles.video} ${props.class ?? ''}`}
          src={props.src}
          poster={props.thumb}
          controls
        />
      </Match>
      <Match when={props.kind === 'audio'}>
        <div class={`${styles.audio} ${props.class ?? ''}`}>
          <span
            class={styles.cover}
            data-empty={!props.thumb}
            style={{ 'background-image': props.thumb ? `url(${props.thumb})` : undefined }}
            role="img"
            aria-label={props.name}
          />
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
          <audio src={props.src} controls />
        </div>
      </Match>
    </Switch>
  )
}
