import { Match, Switch } from 'solid-js'
import styles from './MediaView.module.css'

export interface MediaViewProps {
  kind: 'image' | 'video' | 'audio'
  src: string
  thumb?: string
  name: string
  class?: string
}

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
