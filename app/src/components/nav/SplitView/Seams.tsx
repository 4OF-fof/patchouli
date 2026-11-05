import { Index } from 'solid-js'
import { type Seam, type SplitNode, seamsOf, sizesAt } from './split'
import styles from './Seams.module.css'

/** ペインの幅（px）の下限。 */
const MIN = 160

export interface SeamsProps {
  node: SplitNode
  onSizes: (path: number[], sizes: number[]) => void
}

const pct = (v: number) => `${v * 100}%`

/** 分割したペインの境目。ドラッグで隣どうしの幅を分け直す。ペインと同じ親に重ねて置く。 */
export function Seams(props: SeamsProps) {
  const drag = (seam: Seam, e: PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    if (!(el instanceof HTMLElement)) return
    // 親は display: contents で大きさを持たないので、割合の基準になる箱から測る
    const box = el.offsetParent?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    const row = seam.dir === 'row'
    const span = row ? box.width * seam.box.w : box.height * seam.box.h
    const start = sizesAt(props.node, seam.path)
    const from = row ? e.clientX : e.clientY
    const a = start[seam.i] ?? 0
    const b = start[seam.i + 1] ?? 0
    const min = Math.min(MIN / span, (a + b) / 2)
    const move = (m: PointerEvent) => {
      const d = ((row ? m.clientX : m.clientY) - from) / span
      const next = Math.min(Math.max(a + d, min), a + b - min)
      props.onSizes(seam.path, start.toSpliced(seam.i, 2, next, a + b - next))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return (
    <Index each={seamsOf(props.node)}>
      {(s) => (
        <div
          class={styles.seam}
          role="separator"
          aria-label="ペインの境目"
          aria-orientation={s().dir === 'row' ? 'vertical' : 'horizontal'}
          data-dir={s().dir}
          style={
            s().dir === 'row'
              ? { left: pct(s().at), top: pct(s().box.y), height: pct(s().box.h) }
              : { top: pct(s().at), left: pct(s().box.x), width: pct(s().box.w) }
          }
          onPointerDown={(e) => drag(s(), e)}
        />
      )}
    </Index>
  )
}
