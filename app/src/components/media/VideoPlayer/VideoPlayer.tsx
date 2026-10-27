import { createSignal } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './VideoPlayer.module.css'

export interface VideoPlayerProps {
  src: string
  /** 再生を始めるまで出す絵（サムネイル）。 */
  poster?: string
  name: string
  /** 置き場所の側で大きさを決めるとき。 */
  class?: string
}

/** 動画と、その下に続けて置く操作の帯。全画面にすると、帯も一緒に広がる。 */
export function VideoPlayer(props: VideoPlayerProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [video, setVideo] = createSignal<HTMLVideoElement>()
  const toggle = () => {
    const v = video()
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }
  return (
    <div ref={setRoot} class={`${styles.root} ${props.class ?? ''}`}>
      <div class={styles.screen}>
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
        <video
          ref={setVideo}
          class={styles.video}
          src={props.src}
          poster={props.poster}
          preload="metadata"
          aria-label={props.name}
          onClick={toggle}
        />
      </div>
      <PlayerBar media={video} fullscreen={root} class={styles.bar} />
    </div>
  )
}
