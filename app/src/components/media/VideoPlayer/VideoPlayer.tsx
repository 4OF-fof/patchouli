import { createSignal } from 'solid-js'
import { PlayerBar } from '../PlayerBar/PlayerBar'
import styles from './VideoPlayer.module.css'

export interface VideoPlayerProps {
  src: string
  poster?: string
  name: string
  /** あれば、置き場所の幅いっぱいに、この縦横比（幅 / 高さ）の枠で描く。なければ置き場所に収まる大きさで描く */
  ratio?: number
  /** キーを、この中にフォーカスがあるときだけ受ける */
  local?: boolean
  /** 再生速度のボタンを出すか。既定は出す */
  rate?: boolean
  class?: string
  /** 読み込めたとき。読めなかったときも呼ぶ */
  onReady?: () => void
}

export function VideoPlayer(props: VideoPlayerProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [video, setVideo] = createSignal<HTMLVideoElement>()
  const [natural, setNatural] = createSignal<number>()
  const [playing, setPlaying] = createSignal(false)
  const toggle = () => {
    const v = video()
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }
  return (
    <div
      ref={setRoot}
      class={`${styles.root} ${props.class ?? ''}`}
      data-flow={!!props.ratio}
      data-playing={playing() || undefined}
    >
      <div class={styles.frame} style={{ '--ratio': props.ratio ?? natural() ?? 16 / 9 }}>
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- 素材に字幕はない */}
        <video
          ref={setVideo}
          class={styles.video}
          src={props.src}
          poster={props.poster}
          preload="metadata"
          aria-label={props.name}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) setNatural(v.videoWidth / v.videoHeight)
          }}
          onLoadedData={() => props.onReady?.()}
          onError={() => props.onReady?.()}
        />
        <PlayerBar
          media={video}
          fullscreen={root}
          scope={props.local ? root : undefined}
          rate={props.rate}
          class={styles.bar}
        />
      </div>
    </div>
  )
}
