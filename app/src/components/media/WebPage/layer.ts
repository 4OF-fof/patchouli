import { getOwner, onCleanup } from 'solid-js'
import type { BrowserActions, PageLayer } from '../../../backend/types'

/**
 * 外のページは本体の画面の下に置き、本体の画面に開けた穴から見せる。
 * 穴の上に重ねる表示は穴を塞いで、本体の画面のまま前に出す。
 * どちらも描く順（重ねる表示の中のページは、その表示のあと）に並べて送る。
 */
const holes = new Map<string, { el: HTMLElement; browser: BrowserActions }>()
const covers = new Set<HTMLElement>()
let frame = 0
let sent = ''
let last: BrowserActions | undefined
const moved = new Set<() => void>()

const shown = (el: HTMLElement) =>
  el.isConnected && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })

const depth = (el: HTMLElement) => {
  let n = 0
  for (const c of covers) if (c !== el && c.contains(el)) n++
  return n
}

const collect = (): PageLayer[] => {
  const items = [
    ...[...holes.values()].map(({ el }) => ({ el, hole: true })),
    ...[...covers].filter(shown).map((el) => ({ el, hole: false })),
  ]
  return items
    .map((it) => ({ ...it, depth: depth(it.el) }))
    .toSorted((a, b) => a.depth - b.depth || Number(b.hole) - Number(a.hole))
    .flatMap(({ el, hole }) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return []
      const radius = hole ? 0 : Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
      return [{ hole, x: r.left, y: r.top, width: r.width, height: r.height, radius }]
    })
}

const tick = () => {
  frame = 0
  for (const f of moved) f()
  if (!holes.size && !moved.size) unwatch()
  const b = holes.values().next().value?.browser ?? last
  if (!b) return
  last = b
  const layers = collect()
  const now = JSON.stringify(layers)
  if (now !== sent) {
    sent = now
    b.layer(layers).catch((e: unknown) => console.warn('外のページの重なりを変えられない', e))
  }
}

const kick = () => {
  if (!frame) frame = requestAnimationFrame(tick)
}

// 位置だけが変わったときは知らせがないので、大きさ・スクロール・画面の書き換えのたびに確かめる
const sized = new ResizeObserver(kick)
const changed = new MutationObserver(kick)
let watching = false
const watch = () => {
  if (watching) return
  watching = true
  window.addEventListener('scroll', kick, { capture: true, passive: true })
  window.addEventListener('resize', kick)
  document.addEventListener('transitionend', kick, true)
  document.addEventListener('animationend', kick, true)
  changed.observe(document.body, { subtree: true, childList: true, attributes: true })
}
const unwatch = () => {
  if (!watching) return
  watching = false
  window.removeEventListener('scroll', kick, { capture: true })
  window.removeEventListener('resize', kick)
  document.removeEventListener('transitionend', kick, true)
  document.removeEventListener('animationend', kick, true)
  changed.disconnect()
}

/** 穴や重ねる表示が動いたかもしれないときに呼ぶ。返した関数で呼ぶのをやめる。 */
export function onLayout(f: () => void) {
  moved.add(f)
  watch()
  return () => {
    moved.delete(f)
    kick()
  }
}

/** 外のページを見せる穴。el が出ている間だけ置く。 */
export function setHole(key: string, el: HTMLElement | undefined, browser?: BrowserActions) {
  const was = holes.get(key)?.el
  if (was && was !== el) sized.unobserve(was)
  if (el && browser) {
    holes.set(key, { el, browser })
    sized.observe(el)
    watch()
  } else holes.delete(key)
  kick()
}

/** 外のページより前に出す表示。作ったときに呼ぶと、消えるときに外す。 */
export function coverPage(el: HTMLElement) {
  covers.add(el)
  sized.observe(el)
  kick()
  if (getOwner())
    onCleanup(() => {
      covers.delete(el)
      sized.unobserve(el)
      kick()
    })
}
