import { type Library, type Place, ROOT, samePlace } from '../../../model/library'
import type { IconName } from '../../base/Icon/Icon'
import { CascadeMenu } from '../CascadeMenu/CascadeMenu'
import type { NavMenuEntry } from '../NavMenu/NavMenu'

export interface PlaceMenuProps {
  lib: Library
  /** いちばん上の階層の見出し。渡さないときは出さない */
  title?: string
  /** 今の所属。項目ごとに違うときは渡さない */
  current?: Place
  onPick: (place: Place) => void
  /** 見出しを押したとき */
  onBack?: () => void
  onClose?: () => void
  focusFirst?: boolean
}

const BACK = ':back:'
const TOP = ':root:'
const PROJECT = 'project:'
const GROUP = 'group:'

const keyOf = (p: Place) => (p.group ? GROUP + p.group : PROJECT + p.project)

/** 所属を、階層をたどって選ぶ。下にグループがあるものは、乗せると横に開く。押すとそこを選ぶ。 */
export function PlaceMenu(props: PlaceMenuProps) {
  const lib = () => props.lib
  const placeOfKey = (k: string): Place | undefined => {
    if (k.startsWith(GROUP)) {
      const g = lib().groupBy.get(k.slice(GROUP.length))
      return g && { project: g.project, group: g.id }
    }
    if (k.startsWith(PROJECT)) return { project: k.slice(PROJECT.length), group: null }
    return undefined
  }
  const isCurrent = (p: Place) => !!props.current && samePlace(props.current, p)
  const row = (p: Place, label: string, icon: IconName): NavMenuEntry => ({
    id: keyOf(p),
    icon,
    label,
    current: isCurrent(p),
    sub: lib().groupsIn(p).length > 0,
  })
  const groupsIn = (p: Place) =>
    lib()
      .groupsIn(p)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((g) => row({ project: g.project, group: g.id }, g.name, 'group'))
  const items = (p?: Place): NavMenuEntry[] => {
    if (!p)
      return [
        ...(props.title
          ? [{ id: BACK, icon: 'back' as const, label: props.title, heading: true }, 'separator' as const]
          : []),
        { id: TOP, label: '所属なし', current: isCurrent(ROOT) },
        ...groupsIn(ROOT),
        ...lib().projects.map((x) => row({ project: x.name, group: null }, x.name, 'project')),
      ]
    return groupsIn(p)
  }
  const onSelect = (id: string) => {
    if (id === BACK) props.onBack?.()
    else if (id === TOP) props.onPick(ROOT)
    else {
      const to = placeOfKey(id)
      if (to) props.onPick(to)
    }
  }
  const level = (p?: Place) => (
    <CascadeMenu
      items={items(p)}
      submenu={(id) => {
        const to = placeOfKey(id)
        return to && level(to)
      }}
      selectSub
      onSelect={onSelect}
      onClose={props.onClose}
      focusFirst={!p && props.focusFirst}
    />
  )
  return level()
}
