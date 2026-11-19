/*
 * プラグインの WASM が描いた SVG を、本体の画面に出せるようにする。
 * スクリプト・イベントの属性・外を指す参照を外し、文書の中の # と、image の data:image だけを残す。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

const DROP = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'discard',
  'handler',
  'listener',
])

const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
const IMAGE_SET = /(?:-webkit-)?image-set\([^)]*\)/gi
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif);/i

const local = (v: string) => [...v.matchAll(URL_RE)].every((m) => m[2]?.startsWith('#'))

const cleanCss = (css: string) =>
  css
    .replace(/@import[^;]*;?/gi, '')
    .replace(IMAGE_SET, 'none')
    .replace(URL_RE, (all, _q, u: string) => (u.startsWith('#') ? all : 'none'))

const isHref = (name: string) => name === 'href' || name.endsWith(':href')

/** text を読んで、出してよいものだけを残した svg 要素にする。SVG として読めなければ undefined。 */
export function cleanSvg(text: string): SVGSVGElement | undefined {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (!(root instanceof SVGSVGElement) || doc.querySelector('parsererror')) return undefined
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const tag = el.localName.toLowerCase()
    if (el.namespaceURI !== SVG_NS || DROP.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of el.getAttributeNames()) {
      const name = attr.toLowerCase()
      const v = (el.getAttribute(attr) ?? '').trim()
      const keep = name.startsWith('on')
        ? false
        : isHref(name)
          ? tag !== 'a' && (v.startsWith('#') || (tag === 'image' && DATA_IMAGE.test(v)))
          : name === 'style' || (!/image-set\(/i.test(v) && local(v))
      if (!keep) el.removeAttribute(attr)
      else if (name === 'style') el.setAttribute(attr, cleanCss(v))
    }
    if (tag === 'style') el.textContent = cleanCss(el.textContent ?? '')
  }
  const out = document.importNode(root, true)
  return out instanceof SVGSVGElement ? out : undefined
}
