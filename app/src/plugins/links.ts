/*
 * URL ごとに受け持つもの。plugin.json の links で受け持つプラグインを探し、なければ本体がページの OGP から作る。
 * ホスト名の決まりは src-tauri/src/plugin/mod.rs の host_matches と合わせる。
 */
import type { Detail, Fetched, Thumbnail } from '../../plugins/sdk'
import type { LinkInfo } from './types'

export type Fetch = (url: string) => Promise<Fetched>

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return undefined
  }
}

/** url に当てはまる links。いちばん長いホスト名のものを使う。 */
export function handlerOf(links: ReadonlyMap<string, LinkInfo>, url: string): LinkInfo | undefined {
  let h = hostOf(url)
  while (h) {
    const l = links.get(h)
    if (l) return l
    const i = h.indexOf('.')
    h = i < 0 ? undefined : h.slice(i + 1)
  }
  return undefined
}

/** ページの OGP。 */
export interface Page {
  url: string
  title?: string
  description?: string
  image?: string
}

const charsetOf = (type?: string) => /charset=([\w-]+)/i.exec(type ?? '')?.[1]

function decode(f: Fetched) {
  const head = new TextDecoder().decode(f.body.subarray(0, 4096))
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
  try {
    return new TextDecoder(charsetOf(f.type) ?? meta ?? 'utf-8').decode(f.body)
  } catch {
    return new TextDecoder().decode(f.body)
  }
}

const pages = new Map<string, Promise<Page>>()

/** url のページを読み、OGP を拾う。HTML でなければ URL だけを返す。 */
export function pageOf(url: string, fetch: Fetch): Promise<Page> {
  let p = pages.get(url)
  if (!p) {
    p = (async () => {
      const f = await fetch(url)
      if (f.status >= 400 || !/html/i.test(f.type ?? '')) return { url }
      const doc = new DOMParser().parseFromString(decode(f), 'text/html')
      const meta = (...keys: string[]) => {
        for (const k of keys) {
          const v = doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute('content')?.trim()
          if (v) return v
        }
        return undefined
      }
      const image = meta('og:image', 'og:image:url', 'twitter:image')
      let abs: string | undefined
      try {
        abs = image && new URL(image, f.url).href
      } catch {
        abs = undefined
      }
      return {
        url,
        title: meta('og:title', 'twitter:title') ?? (doc.title.trim() || undefined),
        description: meta('og:description', 'twitter:description', 'description'),
        image: abs,
      }
    })()
    pages.set(url, p)
    p.catch(() => pages.delete(url))
  }
  return p
}

/** 画像を、長いほうの辺が edge 以下の PNG にする。 */
export async function imageThumbnail(src: string, fetch: Fetch, edge: number): Promise<Thumbnail | null> {
  const f = await fetch(src)
  if (f.status >= 400) return null
  const bmp = await createImageBitmap(new Blob([f.body], { type: f.type }))
  const { width, height } = bmp
  const s = Math.min(1, edge / Math.max(width, height))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)))
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return { png: await canvas.convertToBlob({ type: 'image/png' }), width, height }
}

export const pageRows = (p: Page): Detail[] =>
  [
    { label: 'ページ名', value: p.title },
    { label: '説明', value: p.description },
  ].flatMap((r) => (r.value ? [{ label: r.label, value: r.value }] : []))
