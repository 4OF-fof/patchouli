import { createSignal } from 'solid-js'
import { type Library, type Place, ROOT, samePlace } from '../../../model/library'
import type { IconName } from '../../base/Icon/Icon'
import { NavMenu, type NavMenuEntry } from '../NavMenu/NavMenu'

export interface PlaceMenuProps {
  lib: Library
  /** いちばん上の階層の見出し */
  title: string
  /** 今の所属。項目ごとに違うときは渡さない */
  current?: Place
  onPick: (place: Place) => void
  /** いちばん上の階層で見出しを押したとき */
  onBack?: () => void
  onClose?: () => void
}

const BACK = ':back:'
const HERE = ':here:'
const TOP = ':root:'
const PROJECT = 'project:'
const GROUP = 'group:'

const keyOf = (p: Place) => (p.group ? GROUP + p.group : PROJECT + p.project)

/** 所属を、階層をたどって選ぶ。下にグループがあるものは開き、なければそのまま選ぶ。 */
export function PlaceMenu(props: PlaceMenuProps) {
  const lib = () => props.lib
  const [at, setAt] = createSignal<Place>()
  const placeOfKey = (k: string): Place | undefined => {
    if (k.startsWith(GROUP)) {
      const g = lib().groupBy.get(k.slice(GROUP.length))
      return g && { project: g.project, group: g.id }
    }
    if (k.startsWith(PROJECT)) return { project: k.slice(PROJECT.length), group: null }
    return undefined
  }
  const hasKids = (p: Place) => lib().groupsIn(p).length > 0
  const row = (p: Place, label: string, icon: IconName): NavMenuEntry => ({
    id: keyOf(p),
    icon,
    label,
    current: !!props.current && samePlace(props.current, p),
    ...(hasKids(p) && { hint: '›' }),
  })
  const groupsIn = (p: Place) =>
    lib()
      .groupsIn(p)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((g) => row({ project: g.project, group: g.id }, g.name, 'group'))
  const nameOf = (p: Place) => (p.group ? (lib().groupBy.get(p.group)?.name ?? '') : (p.project ?? ''))
  const parentOf = (p: Place): Place | undefined => {
    const g = p.group ? lib().groupBy.get(p.group) : undefined
    if (g?.parent) return { project: g.project, group: g.parent }
    if (g?.project) return { project: g.project, group: null }
    return undefined
  }
  const items = (): NavMenuEntry[] => {
    const p = at()
    if (!p)
      return [
        { id: BACK, icon: 'back', label: props.title, heading: true },
        'separator',
        { id: TOP, label: '所属なし', current: !!props.current && samePlace(props.current, ROOT) },
        ...groupsIn(ROOT),
        ...lib().projects.map((x) => row({ project: x.name, group: null }, x.name, 'folder')),
      ]
    return [
      { id: BACK, icon: 'back', label: lib().placeName(p) ?? '', heading: true },
      'separator',
      {
        id: HERE,
        icon: p.group ? 'group' : 'folder',
        label: nameOf(p),
        hint: 'ここ',
        current: !!props.current && samePlace(props.current, p),
      },
      ...groupsIn(p),
    ]
  }
  const onSelect = (id: string) => {
    const p = at()
    if (id === BACK) {
      if (p) setAt(parentOf(p))
      else props.onBack?.()
    } else if (id === HERE) {
      if (p) props.onPick(p)
    } else if (id === TOP) props.onPick(ROOT)
    else {
      const to = placeOfKey(id)
      if (to && hasKids(to)) setAt(to)
      else if (to) props.onPick(to)
    }
  }
  return <NavMenu items={items()} onSelect={onSelect} onClose={props.onClose} focusFirst />
}
