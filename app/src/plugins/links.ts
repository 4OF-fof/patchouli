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

/** OGP の画像と同じ縦横比。 */
const ICON_RATIO = 1.91

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

/** サイトのアイコンがないときに描く、地球の印（lucide の globe）。24 の枠で描く。 */
const GLOBE = ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20']

/** OGP の画像がないページの、サイトのアイコンとホスト名を並べたサムネイル。アイコンが読めなければ地球の印を描く。 */
export async function iconThumbnail(page: Page, fetch: Fetch, edge: number): Promise<Thumbnail | null> {
  const img = await siteIcon(page, fetch)
  const [w, h] = [edge, Math.round(edge / ICON_RATIO)]
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')
  if (!g) return null
  const natural = img ? Math.max(img.naturalWidth, img.naturalHeight) : 0
  const full = Math.round(h * 0.3)
  // 小さいアイコンは、引き伸ばしすぎてぼやけないようにする
  const size = natural && natural < full / 2 ? natural * 2 : full
  const font = Math.round(h * 0.075)
  const gap = Math.round(h * 0.06)
  const top = Math.round((h - size - gap - font) / 2)
  const left = (w - size) / 2
  // 背景は透かし、暗い地にも明るい地にも見える中間の灰色（tokens.css の --muted）で描く
  const gray = '#8e929a'
  if (img) g.drawImage(img, left, top, size, size)
  else {
    g.save()
    g.translate(left, top)
    g.scale(size / 24, size / 24)
    g.strokeStyle = gray
    g.lineWidth = 1.5
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.arc(12, 12, 10, 0, Math.PI * 2)
    g.stroke()
    for (const d of GLOBE) g.stroke(new Path2D(d))
    g.restore()
  }
  g.fillStyle = gray
  g.font = `${font}px 'Noto Sans JP Variable', system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'top'
  g.fillText(hostOf(page.url) ?? page.url, w / 2, top + size + gap, w - font * 4)
  return { png: await canvas.convertToBlob({ type: 'image/png' }), width: w, height: h }
}

export const pageRows = (p: Page): Detail[] =>
  [
    { label: 'ページ名', value: p.title },
    { label: '説明', value: p.description },
  ].flatMap((r) => (r.value ? [{ label: r.label, value: r.value }] : []))
