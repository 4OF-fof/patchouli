/** 窓の左上から中身の左上までのずれ。ポインターが乗ったときに測る。窓を動かしても変わらない。 */
const inset = new WeakMap<Window, { x: number; y: number }>()

/** ほかの窓で起きて、この窓に写して送ったもの。位置はほかの窓のものなので、ずれは測らない。 */
export const relayed = new WeakSet<Event>()

/** 窓 w の上のポインターから、中身のずれを測り続ける。 */
export function watchViewport(w: Window) {
  const measure = (e: PointerEvent) => {
    if (!relayed.has(e)) inset.set(w, { x: e.screenX - e.clientX - w.screenX, y: e.screenY - e.clientY - w.screenY })
  }
  w.addEventListener('pointermove', measure, { capture: true, passive: true })
  w.addEventListener('pointerdown', measure, { capture: true, passive: true })
  return () => {
    w.removeEventListener('pointermove', measure, { capture: true })
    w.removeEventListener('pointerdown', measure, { capture: true })
  }
}

/** 窓の中身の、画面の上の位置と大きさ。まだ測っていなければ、枠の太さは左右と下で同じとみなす。 */
export function viewportOf(w: Window) {
  const side = (w.outerWidth - w.innerWidth) / 2
  const d = inset.get(w) ?? { x: side, y: w.outerHeight - w.innerHeight - side }
  return { x: w.screenX + d.x, y: w.screenY + d.y, w: w.innerWidth, h: w.innerHeight }
}
