import { createEffect, onCleanup } from 'solid-js'
import { useHost } from '../../window/host'

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
  const host = useHost()
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
    const { doc, win } = host()
    doc.addEventListener('pointerdown', onOutside, true)
    if (o.move) {
      win.addEventListener('resize', onMove)
      win.addEventListener('scroll', onMove, true)
    }
    onCleanup(() => {
      doc.removeEventListener('pointerdown', onOutside, true)
      win.removeEventListener('resize', onMove)
      win.removeEventListener('scroll', onMove, true)
    })
  })
}
