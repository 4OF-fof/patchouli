import { floating } from '../../../window/floating'
import styles from './ghost.module.css'

/** 窓の外に出す小さな窓で、写しの影を描くために周りに空ける幅（px）。 */
const PAD = 12

/** 窓の外に出す小さな窓（public/ghost.html）に渡すもの。本体の CSS と html の属性を写し、写しをそのまま描かせる。 */
function pageOf(g: HTMLElement) {
  const c = g.cloneNode(true)
  if (!(c instanceof HTMLElement)) return ''
  c.style.transform = `translate(${PAD}px, ${PAD}px)`
  c.style.visibility = ''
  const doc = g.ownerDocument
  return encodeURIComponent(
    JSON.stringify({
      attrs: [...doc.documentElement.attributes].map((a) => [a.name, a.value]),
      css: [...doc.head.querySelectorAll('style, link[rel="stylesheet"]')].map((e) => e.outerHTML).join(''),
      tab: c.outerHTML,
    }),
  )
}

/**
 * つかんだタブの写し。列の外へ運んでいるあいだ、つかんだところをカーソルに合わせて動かす。r は押したときのタブの位置。
 * 窓の外では、デスクトップなら小さな窓に描き替える
 */
export function ghostOf(el: HTMLElement, r: DOMRect, grabX: number, grabY: number) {
  const g = el.cloneNode(true)
  if (!(g instanceof HTMLElement)) return undefined
  for (const a of ['data-tab', 'data-dragged', 'data-lifted', 'data-drop', 'style']) g.removeAttribute(a)
  g.classList.add(styles.ghost)
  g.inert = true
  g.setAttribute('aria-hidden', 'true')
  g.style.width = `${r.width}px`
  g.style.height = `${r.height}px`
  const dx = grabX - r.left
  const dy = grabY - r.top
  el.ownerDocument.body.append(g)
  const away = floating(() => pageOf(g), r.width + PAD * 2, r.height + PAD * 2)
  return {
    /** client は窓の中の位置、screen は画面の上の位置。out なら窓の外にある。 */
    move: (client: { x: number; y: number }, screen: { x: number; y: number }, out: boolean) => {
      g.style.transform = `translate(${client.x - dx}px, ${client.y - dy}px)`
      g.style.visibility = out && away ? 'hidden' : ''
      if (out) away?.show(screen.x - dx - PAD, screen.y - dy - PAD)
      else away?.hide()
    },
    remove: () => {
      g.remove()
      away?.hide()
    },
  }
}
