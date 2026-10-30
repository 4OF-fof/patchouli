/*
 * 動画のサムネイル。WebView のデコーダーで 1 秒目のコマを取る（詳細での再生と同じもので読む）。
 * WebView で読めないものは、FFmpeg があれば WASM の call（frame）で取り出す。
 */

import { definePlugin } from '@patchouli/plugin'

interface Video {
  methods: { frame(edge: number): string }
}

/** 最初のコマは黒いことが多いので、1 秒目から取る。それより短ければ最初のコマ。 */
const AT = 1

const until = (v: HTMLVideoElement, event: string) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      v.removeEventListener(event, done)
      v.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      v.removeEventListener(event, done)
      v.removeEventListener('error', fail)
      reject(new Error(`WebView で動画を読めません（${v.error?.message || v.error?.code || '不明'}）`))
    }
    v.addEventListener(event, done)
    v.addEventListener('error', fail)
  })

async function grab(url: string, edge: number) {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  // 素材の URL は画面と別のオリジンなので、CORS で読まないと canvas から書き出せない
  v.crossOrigin = 'anonymous'
  v.src = url
  try {
    await until(v, 'loadeddata')
    if (Number.isFinite(v.duration) && v.duration > AT) {
      v.currentTime = AT
      await until(v, 'seeked')
    }
    const { videoWidth: width, videoHeight: height } = v
    if (!width || !height) throw new Error('WebView で映像を読めません')
    const scale = Math.min(1, edge / Math.max(width, height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(width * scale))
    c.height = Math.max(1, Math.round(height * scale))
    const g = c.getContext('2d')
    if (!g) throw new Error('canvas を使えません')
    g.imageSmoothingQuality = 'high'
    g.drawImage(v, 0, 0, c.width, c.height)
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (!png) throw new Error('PNG にできません')
    return { png, width, height }
  } finally {
    v.removeAttribute('src')
    v.load()
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default definePlugin<Video>({
  async thumbnail(api) {
    let failed: string | undefined
    if (api.item.url) {
      try {
        return await grab(api.item.url, api.edge)
      } catch (e) {
        failed = message(e)
      }
    }
    const b64 = await api.call('frame', api.edge).catch((e: unknown) => {
      throw new Error(failed ? `${failed} / ${message(e)}` : message(e))
    })
    return { png: Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) }
  },
})
