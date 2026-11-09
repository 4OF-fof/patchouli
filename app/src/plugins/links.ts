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
  /** サイトのアイコン。ページに書いてあるもののうち、いちばん大きいもの。 */
  icon?: string
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

const absolute = (href: string | null | undefined, base: string) => {
  try {
    return href ? new URL(href, base).href : undefined
  } catch {
    return undefined
  }
}

/** link の rel と sizes から、大きいものを選ぶ。SVG はどの大きさでもきれいなので先にする。 */
function iconOf(doc: Document, base: string) {
  let best: { href: string; size: number } | undefined
  for (const l of doc.querySelectorAll<HTMLLinkElement>('link[rel][href]')) {
    const rel = l.rel.toLowerCase().split(/\s+/)
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')
    if (!touch && !rel.includes('icon')) continue
    const href = absolute(l.getAttribute('href'), base)
    if (!href) continue
    const sizes = l.getAttribute('sizes')?.toLowerCase() ?? ''
    const svg = /svg/i.test(l.type) || /\.svg(\?|#|$)/i.test(href) || sizes === 'any'
    const given = Math.max(0, ...sizes.split(/\s+/).map((x) => Number(x.split('x')[0]) || 0))
    const size = svg ? Infinity : given || (touch ? 180 : 16)
    if (!best || size > best.size) best = { href, size }
  }
  return best?.href
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
      return {
        url,
        title: meta('og:title', 'twitter:title') ?? (doc.title.trim() || undefined),
        description: meta('og:description', 'twitter:description', 'description'),
        image: absolute(meta('og:image', 'og:image:url', 'twitter:image'), f.url),
        icon: iconOf(doc, f.url),
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

/** サイトアイコンの PNG の一辺。 */
const SITE_ICON = 128

/** ショートカットのサムネイルがこの大きさなら、ページの画像でなくサイトアイコンとして表示する。 */
export const isSiteIcon = (width?: number | null, height?: number | null) => width === SITE_ICON && height === SITE_ICON

/** SVG と ICO も読めるよう、img で読む。 */
async function loadImage(src: string) {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

async function loadIcon(src: string, fetch: Fetch) {
  if (src.startsWith('data:')) return loadImage(src)
  const f = await fetch(src)
  if (f.status >= 400) throw new Error(`${f.status}`)
  const url = URL.createObjectURL(new Blob([f.body], { type: f.type }))
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** ページに書いてあるアイコン、なければ /favicon.ico。どちらも読めなければ undefined。 */
async function siteIcon(page: Page, fetch: Fetch) {
  for (const src of new Set([page.icon, absolute('/favicon.ico', page.url)])) {
    const img = src && (await loadIcon(src, fetch).catch(() => undefined))
    if (img) return img
  }
  return undefined
}

/** OGP の画像がないページの、サイトアイコンの PNG。読めなければ null。 */
export async function iconThumbnail(page: Page, fetch: Fetch): Promise<Thumbnail | null> {
  const img = await siteIcon(page, fetch)
  if (!img) return null
  const canvas = new OffscreenCanvas(SITE_ICON, SITE_ICON)
  const g = canvas.getContext('2d')
  if (!g) return null
  const [w, h] = [img.naturalWidth || SITE_ICON, img.naturalHeight || SITE_ICON]
  const s = SITE_ICON / Math.max(w, h)
  // 小さいアイコンは、拡大でぼやけないよう補間しない
  g.imageSmoothingEnabled = Math.max(w, h) >= SITE_ICON / 2
  g.drawImage(img, (SITE_ICON - w * s) / 2, (SITE_ICON - h * s) / 2, w * s, h * s)
  return { png: await canvas.convertToBlob({ type: 'image/png' }), width: SITE_ICON, height: SITE_ICON }
}

export const pageRows = (p: Page): Detail[] =>
  [
    { label: 'ページ名', value: p.title },
    { label: '説明', value: p.description },
  ].flatMap((r) => (r.value ? [{ label: r.label, value: r.value }] : []))
