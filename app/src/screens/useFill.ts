import { createSignal, onCleanup, onMount } from 'solid-js'

/**
 * 追記式の一覧で、何件まで出すか。下の端（end）から 1 画面分先までを、待たずに埋める。
 * 足すと段の最後の行が組み直されるので、見える前に済ませる。
 */
export function useFill(o: {
  scroll: () => HTMLElement | undefined
  end: () => HTMLElement | undefined
  total: () => number
  first: number
  more: number
}) {
  const [shown, setShown] = createSignal(o.first)
  const fill = () => {
    const scroll = o.scroll()
    const end = o.end()
    if (!scroll || !end) return
    const limit = scroll.getBoundingClientRect().bottom + scroll.clientHeight
    while (shown() < o.total() && end.getBoundingClientRect().top < limit) setShown(shown() + o.more)
  }
  onMount(() => {
    const scroll = o.scroll()
    // onMount の中で足しても描き直しが後回しになるので、描く前に走るマイクロタスクで埋める
    queueMicrotask(fill)
    if (!scroll) return
    // 見える・見えないの切り替わりで知らせる IntersectionObserver は、足し終えた位置が見張る範囲の端に重なると
    // それきり知らせが来なくなるので、スクロールと大きさの変化のたびに確かめる
    const ro = new ResizeObserver(fill)
    ro.observe(scroll)
    scroll.addEventListener('scroll', fill, { passive: true })
    onCleanup(() => {
      ro.disconnect()
      scroll.removeEventListener('scroll', fill)
    })
  })
  return { shown, fill }
}
