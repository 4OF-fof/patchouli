import { createEffect, onCleanup } from 'solid-js'

/**
 * 開いているあいだ、pop と anchor の外を押したら onClose を呼ぶ。
 * move なら、窓の大きさが変わったときと、pop の外がスクロールしたときにも呼ぶ（置いた位置がずれるので）。
 */
export function usePopover(o: {
  pop: () => Node | undefined
  anchor?: () => Node | undefined
  onClose: () => void
  /** 省くと、使っている部品があるあいだずっと開いているものとする */
  open?: () => boolean
  move?: boolean
}) {
  const inside = (t: EventTarget | null) => t instanceof Node && (!!o.pop()?.contains(t) || !!o.anchor?.()?.contains(t))
  const onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && !inside(e.target)) o.onClose()
  }
  const onMove = (e: Event) => {
    if (e.type === 'scroll' && e.target instanceof Node && o.pop()?.contains(e.target)) return
    o.onClose()
  }
  createEffect(() => {
    if (o.open && !o.open()) return
    document.addEventListener('pointerdown', onOutside, true)
    if (o.move) {
      window.addEventListener('resize', onMove)
      window.addEventListener('scroll', onMove, true)
    }
    onCleanup(() => {
      document.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    })
  })
}
