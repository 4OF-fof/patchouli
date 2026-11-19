import { ContextMenu } from '../../overlay/ContextMenu/ContextMenu'
import { NavMenu, type NavMenuItem } from '../NavMenu/NavMenu'
import type { SplitSide } from '../SplitView/split'

export type TabAction = SplitSide | 'window'

const ITEMS: Record<TabAction, NavMenuItem> = {
  right: { id: 'right', icon: 'splitRight', label: '右に分割' },
  down: { id: 'down', icon: 'splitDown', label: '下に分割' },
  window: { id: 'window', icon: 'external', label: '別のウィンドウで開く' },
}

export interface TabMenuProps {
  x: number
  y: number
  actions: TabAction[]
  onAction: (a: TabAction) => void
  onClose: () => void
}

/** タブを右クリックしたときのメニュー。 */
export function TabMenu(props: TabMenuProps) {
  return (
    <ContextMenu x={props.x} y={props.y} onClose={props.onClose}>
      <NavMenu
        items={props.actions.map((a) => ITEMS[a])}
        focusFirst
        onSelect={(id) => {
          const a = props.actions.find((x) => x === id)
          props.onClose()
          if (a) props.onAction(a)
        }}
        onClose={props.onClose}
      />
    </ContextMenu>
  )
}
