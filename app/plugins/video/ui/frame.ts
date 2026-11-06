/*
 * 動画のサムネイルと、内容を読むときのコマ。WebView のデコーダーで取る（詳細での再生と同じもので読む）。
 * WebView で読めないものは、サムネイルは sandbox の thumbnail、コマは WASM の call（frames）で、FFmpeg があれば取り出す。
 * 音声トラックは WASM の excerpt が読む。
 */

import { type ExcerptBudget, type ExcerptPart, definePlugin } from '@patchouli/plugin'

interface Video {
  methods: { frames(args: string): string[]; secs(): number | null }
}

/** 最初のコマは黒いことが多いので、1 秒目から取る。それより短ければ最初のコマ。 */
const AT = 1

/** コマを取る間隔と、コマをまとめる区間の長さ（秒）。 */
const EVERY = 5
const SPAN = 15

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

const load = async (url: string) => {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  // 素材の URL は画面と別のオリジンなので、CORS で読まないと canvas から書き出せない
  v.crossOrigin = 'anonymous'
  v.src = url
  try {
    await until(v, 'loadeddata')
  } catch (e) {
    unload(v)
    throw e
  }
  return v
}

const unload = (v: HTMLVideoElement) => {
  v.removeAttribute('src')
  v.load()
}

const seek = async (v: HTMLVideoElement, at: number) => {
  v.currentTime = at
  await until(v, 'seeked')
}

async function draw(v: HTMLVideoElement, edge: number, type: string) {
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
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.85))
  if (!blob) throw new Error('画像にできません')
  return { blob, width, height }
}

async function grab(url: string, edge: number) {
  const v = await load(url)
  try {
    if (Number.isFinite(v.duration) && v.duration > AT) await seek(v, AT)
    const { blob: png, width, height } = await draw(v, edge, 'image/png')
    return { png, width, height }
  } finally {
    unload(v)
  }
}

/**
 * secs を SPAN 秒ずつに分けた区間の始まり。max より多ければ、全体から均等に max 個選ぶ。
 * WASM を呼ばずにコマを取ることもあるのでここにも置き、plugins/shared/excerpt.rs の starts と同じにする。
 */
const starts = (secs: number, max: number) => {
  const n = Math.max(1, Math.ceil(secs / SPAN))
  const picked = n <= max ? [...Array(n).keys()] : [...Array(max).keys()].map((i) => Math.floor((i * n) / max))
  return picked.map((i) => i * SPAN)
}

/** WebView で、区間ごとに EVERY 秒おきのコマを取る。 */
async function grabParts(url: string, budget: ExcerptBudget, signal: AbortSignal): Promise<ExcerptPart[]> {
  const v = await load(url)
  try {
    const secs = v.duration
    if (!Number.isFinite(secs)) throw new Error('動画の長さがわかりません')
    const parts: ExcerptPart[] = []
    for (const start of starts(secs, budget.maxImageParts)) {
      const end = Math.min(start + SPAN, secs)
      const images: Blob[] = []
      for (let t = start; t < end && images.length < budget.maxImages; t += EVERY) {
        signal.throwIfAborted()
        await seek(v, t)
        images.push((await draw(v, budget.edge, 'image/jpeg')).blob)
      }
      if (images.length) parts.push({ start, end, images })
    }
    return parts
  } finally {
    unload(v)
  }
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))

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
    return api.sandbox().catch((e: unknown) => {
      throw new Error(failed ? `${failed} / ${message(e)}` : message(e))
    })
  },
  async excerpt(api) {
    const { budget, signal } = api
    // 音声は裏の WASM が読むので、コマを取るのと並べて進める
    const audio = api.sandbox().catch((e: unknown) => console.warn('音声トラックを読めない', e))
    try {
      if (api.item.url) {
        try {
          return await grabParts(api.item.url, budget, signal)
        } catch (e) {
          if (signal.aborted) throw e
          console.warn('WebView でコマを取れない。FFmpeg で取る', e)
        }
      }
      const secs = await api.call('secs')
      if (!secs) throw new Error('動画の長さがわかりません')
      const parts: ExcerptPart[] = []
      for (const start of starts(secs, budget.maxImageParts)) {
        signal.throwIfAborted()
        const got = await api.call('frames', `${start},${SPAN},${EVERY},${budget.maxImages},${budget.edge}`)
        if (got.length) parts.push({ start, end: Math.min(start + SPAN, secs), images: got.map(bytes) })
      }
      return parts
    } finally {
      await audio
    }
  },
})
