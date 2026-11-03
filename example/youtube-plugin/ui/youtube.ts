/*
 * YouTube の動画の URL。サムネイルは動画の ID から決まる画像を、詳細は oEmbed を、表示は埋め込みのプレーヤーを使う。
 * 例のプラグインとして、plugin.json の links と fetch の使い方を見せる。
 */

import { type LinkApi, definePlugin } from '@patchouli/plugin'

function videoOf(url: string) {
  const u = new URL(url)
  if (u.hostname === 'youtu.be') return u.pathname.slice(1) || undefined
  const v = u.searchParams.get('v')
  if (v) return v
  return /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname)?.[1]
}

function player(el: HTMLElement, api: LinkApi, fill: boolean) {
  const id = videoOf(api.url)
  if (!id) {
    el.textContent = '動画の URL ではありません'
    return
  }
  const frame = document.createElement('iframe')
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
  frame.title = 'YouTube'
  frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.allowFullscreen = true
  Object.assign(frame.style, { display: 'block', width: '100%', aspectRatio: '16 / 9', border: '0' })
  if (fill) frame.style.maxHeight = '100%'
  el.replaceChildren(frame)
  return () => frame.remove()
}

export default definePlugin({
  links: {
    async thumbnail(api) {
      const id = videoOf(api.url)
      if (!id) return null
      const f = await api.fetch(`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`)
      if (f.status >= 400) return null
      const bmp = await createImageBitmap(new Blob([f.body], { type: f.type }))
      // hqdefault は 4:3 で、上下に黒い帯が付いている
      const h = Math.round((bmp.width * 9) / 16)
      const top = Math.round((bmp.height - h) / 2)
      const s = Math.min(1, api.edge / bmp.width)
      const canvas = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(h * s))
      canvas.getContext('2d')?.drawImage(bmp, 0, top, bmp.width, h, 0, 0, canvas.width, canvas.height)
      bmp.close()
      return { png: await canvas.convertToBlob({ type: 'image/png' }) }
    },
    mount: (el, api) => player(el, api, true),
    embed: (el, api) => player(el, api, false),
    async details(api) {
      const f = await api.fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(api.url)}`)
      if (f.status >= 400) return []
      const o: { title?: string; author_name?: string } = JSON.parse(new TextDecoder().decode(f.body))
      return [
        { label: 'タイトル', value: o.title ?? '' },
        { label: 'チャンネル', value: o.author_name ?? '' },
      ].filter((r) => r.value)
    },
  },
})
