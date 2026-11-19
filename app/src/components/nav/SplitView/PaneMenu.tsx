import type { IconName } from '../../base/Icon/Icon'
import { ContextMenu } from '../../overlay/ContextMenu/ContextMenu'
import { NavMenu } from '../NavMenu/NavMenu'
import type { PaneDir, Rect } from './split'
import styles from './PaneMenu.module.css'

const ITEMS: Record<PaneDir, { icon: IconName; label: string }> = {
  left: { icon: 'back', label: '左に移動' },
  right: { icon: 'chevron', label: '右に移動' },
  up: { icon: 'chevronUp', label: '上に移動' },
  down: { icon: 'chevronDown', label: '下に移動' },
}

export interface PaneMove {
  dir: PaneDir
  /** 入れ替える先のペインのタブ。 */
  to: number
}

export interface PaneMenuProps {
  x: number
  y: number
  moves: PaneMove[]
  /** 項目に乗せているあいだ、入れ替える先のペイン。離れたら undefined。 */
  onPreview: (to: number | undefined) => void
  onMove: (to: number) => void
  onClose: () => void
}

/** 分割したペインの、何もないところを右クリックしたときのメニュー。動かせる向きだけを出す。 */
export function PaneMenu(props: PaneMenuProps) {
  const toOf = (id: string) => props.moves.find((m) => m.dir === id)?.to
  return (
    <ContextMenu x={props.x} y={props.y} onClose={props.onClose}>
      <div onPointerLeave={() => props.onPreview(undefined)}>
        <NavMenu
          items={props.moves.map((m) => ({ id: m.dir, ...ITEMS[m.dir] }))}
          focusFirst
          onHover={(id) => props.onPreview(toOf(id))}
          onSelect={(id) => {
            const to = toOf(id)
            props.onClose()
            if (to !== undefined) props.onMove(to)
          }}
          onClose={props.onClose}
        />
      </div>
    </ContextMenu>
  )
}

const pct = (v: number) => `${v * 100}%`

/** 入れ替える先のペインに重ねる、半透明の印。ペインと同じ親に置く。 */
export function PaneHint(props: { rect: Rect }) {
  return (
    <div
      class={styles.hint}
      style={{
        left: pct(props.rect.x),
        top: pct(props.rect.y),
        width: pct(props.rect.w),
        height: pct(props.rect.h),
      }}
    />
  )
}
