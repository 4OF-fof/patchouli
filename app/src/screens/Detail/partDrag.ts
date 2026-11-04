const cardsOf = (el: Element) => {
  const card = el.closest<HTMLElement>('[data-part]')
  const cards = card?.parentElement ? [...card.parentElement.querySelectorAll<HTMLElement>(':scope > [data-part]')] : []
  return { card, cards, i: card ? cards.indexOf(card) : -1 }
}

/**
 * つまみを押したまま動かすあいだ、掴んだカードを指に付けて、ほかのカードを空く場所へずらす。
 * 離したら、何枚ぶん動いたかを onMove に渡す。並びは DOM の兄弟の [data-part] から読む。
 */
export function dragPart(e: PointerEvent & { currentTarget: HTMLElement }, onMove: (by: number) => void) {
  const handle = e.currentTarget
  const { card, cards, i } = cardsOf(handle)
  if (!card || e.button !== 0) return
  e.preventDefault()
  handle.setPointerCapture(e.pointerId)
  const rects = cards.map((c) => c.getBoundingClientRect())
  const mids = rects.map((r) => r.top + r.height / 2)
  const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0
  const step = rects[i].height + gap
  let to = i
  for (const c of cards) c.dataset.sorting = 'true'
  card.dataset.dragging = 'true'
  const move = (ev: PointerEvent) => {
    const dy = ev.clientY - e.clientY
    to = mids.filter((m, k) => k !== i && m < mids[i] + dy).length
    card.style.translate = `0 ${dy}px`
    cards.forEach((c, k) => {
      if (k !== i) c.style.translate = k > i && k <= to ? `0 ${-step}px` : k < i && k >= to ? `0 ${step}px` : ''
    })
  }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    for (const c of cards) {
      delete c.dataset.sorting
      delete c.dataset.dragging
      c.style.translate = ''
    }
    if (to !== i) onMove(to - i)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

/** ↑↓ キーで 1 枚ぶん動かす。動かしたあとも、同じカードのつまみにフォーカスを残す。 */
export function nudgePart(e: KeyboardEvent & { currentTarget: Element }, onMove: (by: number) => void) {
  const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  const { cards, i } = cardsOf(e.currentTarget)
  if (!by || i + by < 0 || i + by >= cards.length) return
  e.preventDefault()
  onMove(by)
  cards[i + by].querySelector<HTMLElement>('[data-grip]')?.focus()
}
