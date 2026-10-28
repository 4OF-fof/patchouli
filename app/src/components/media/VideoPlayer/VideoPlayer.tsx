import { createSignal } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './VideoPlayer.module.css'

export interface VideoPlayerProps {
  src: string
  poster?: string
  name: string
  /** 置き場所に高さがないとき、映像の枠をこの縦横比（幅 / 高さ）にする */
  ratio?: number
  /** キーを、この中にフォーカスがあるときだけ受ける */
  local?: boolean
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
}

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
      <div class={styles.screen} data-fixed={!!props.ratio} style={{ 'aspect-ratio': props.ratio }}>
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
        <video
          ref={setVideo}
          class={styles.video}
          src={props.src}
          poster={props.poster}
          preload="metadata"
          aria-label={props.name}
          onClick={toggle}
          onLoadedData={() => props.onReady?.()}
          onError={() => props.onReady?.()}
        />
      </div>
      <PlayerBar media={video} fullscreen={root} scope={props.local ? root : undefined} class={styles.bar} />
    </div>
  )
}
