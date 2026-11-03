import { Match, Switch, onMount } from 'solid-js'
import { type Item, type Library, type Place, placeOf, samePlace } from '../../../model/library'
import { TagPicker } from '../../controls/TagPicker/TagPicker'
import { CascadeMenu } from '../../nav/CascadeMenu/CascadeMenu'
import type { NavMenuEntry } from '../../nav/NavMenu/NavMenu'
import { PlaceMenu } from '../../nav/PlaceMenu/PlaceMenu'
import { ContextMenu } from '../ContextMenu/ContextMenu'

/** プラグインが足す項目。 */
export interface ItemMenuEntry {
  id: string
  label: string
}

export interface ItemMenuProps {
  /** 選んでいる項目。2 つ以上なら、操作をすべてにかける。 */
  items: Item[]
  x: number
  y: number
  anchor?: Element
  /** 開いている画面の「その他」から出したとき。画面のボタンや情報でできる操作と、新しいタブで開くは出さない。 */
  onScreen?: boolean
  /** items のうち、ピン留めしている数。 */
  pinned: number
  lib: Library
  tags: string[]
  recentTags: string[]
  plugins?: ItemMenuEntry[]
  revealLabel?: string
  onOpen: () => void
  onOpenInTab?: () => void
  onOpenDefault?: () => void
  onReveal?: () => void
  onMove: (place: Place) => void
  onTag: (tag: string, on: boolean) => void
  onPin: (on: boolean) => void
  onCopyPath?: () => void
  onCopyName: () => void
  onPlugin?: (id: string) => void
  onDelete?: () => void
  onClose: () => void
}

const PLUGIN = 'plugin:'

const group = (xs: (NavMenuEntry | false | undefined)[]): NavMenuEntry[] => xs.filter((x): x is NavMenuEntry => !!x)

export function ItemMenu(props: ItemMenuProps) {
  let box!: HTMLDivElement
  onMount(() => queueMicrotask(() => box.querySelector<HTMLElement>('[role="menu"]')?.focus()))
  const n = () => props.items.length
  const one = () => (n() === 1 ? props.items[0] : undefined)
  const allPinned = () => props.pinned === n()
  const main = (): NavMenuEntry[] => {
    const plugins = props.plugins ?? []
    const it = one()
    const opens = it
      ? group([
          !props.onScreen && { id: 'open', icon: it.note ? 'note' : 'file', label: '開く' },
          !props.onScreen && props.onOpenInTab && { id: 'tab', icon: 'newTab', label: '新しいタブで開く' },
          props.onOpenDefault && { id: 'default', icon: 'external', label: '既定のアプリで開く' },
          props.onReveal && { id: 'reveal', icon: 'folder', label: props.revealLabel ?? 'フォルダを開く' },
        ])
      : []
    return [
      ...(opens.length ? [...opens, 'separator' as const] : []),
      ...(props.onScreen
        ? []
        : [
            { id: 'move', icon: 'move', label: '移動', sub: true } as const,
            { id: 'tag', icon: 'tag', label: 'タグを追加', sub: true } as const,
            'separator' as const,
          ]),
      ...group([
        !props.onScreen && { id: 'pin', icon: 'pin', label: allPinned() ? 'ピン留めを解除' : 'ピン留め' },
        props.onCopyPath && { id: 'path', icon: 'copy', label: 'パスをコピー' },
        { id: 'name', icon: 'copy', label: '名前をコピー' },
      ]),
      ...(plugins.length
        ? [
            'separator' as const,
            ...plugins.map((p): NavMenuEntry => ({ id: PLUGIN + p.id, icon: 'plugin', label: p.label })),
          ]
        : []),
      ...(props.onDelete
        ? [
            'separator' as const,
            { id: 'delete', icon: 'trash' as const, label: it ? '削除' : `${n()} 件を削除`, danger: true },
          ]
        : []),
    ]
  }
  const current = () => {
    const [first, ...rest] = props.items
    return first && rest.every((i) => samePlace(i, first)) ? placeOf(first) : undefined
  }
  const countOf = (t: string) => props.items.filter((i) => i.tags.includes(t)).length
  const common = () => props.tags.filter((t) => countOf(t) === n())
  const mixed = () =>
    Object.fromEntries(
      props.tags.flatMap((t) => {
        const c = countOf(t)
        return c > 0 && c < n() ? [[t, `${c}/${n()}`]] : []
      }),
    )
  const done = (f?: () => void) => {
    f?.()
    props.onClose()
  }
  const onMain = (id: string) => {
    if (id.startsWith(PLUGIN)) done(() => props.onPlugin?.(id.slice(PLUGIN.length)))
    else done(run()[id])
  }
  const run = (): Record<string, (() => void) | undefined> => ({
    open: props.onOpen,
    tab: props.onOpenInTab,
    default: props.onOpenDefault,
    reveal: props.onReveal,
    pin: () => props.onPin(!allPinned()),
    path: props.onCopyPath,
    name: props.onCopyName,
    delete: props.onDelete,
  })
  const submenu = (id: string) => (
    <Switch>
      <Match when={id === 'move'}>
        <PlaceMenu
          lib={props.lib}
          current={current()}
          onPick={(to) => done(() => props.onMove(to))}
          onClose={props.onClose}
        />
      </Match>
      <Match when={id === 'tag'}>
        <TagPicker
          tags={common()}
          mixed={mixed()}
          all={props.tags}
          recent={props.recentTags}
          suggested={[]}
          onToggle={props.onTag}
          onClose={props.onClose}
          anchor={box}
        />
      </Match>
    </Switch>
  )
  return (
    <ContextMenu x={props.x} y={props.y} anchor={props.anchor} onClose={props.onClose}>
      <div ref={box}>
        <CascadeMenu items={main()} submenu={submenu} onSelect={onMain} onClose={props.onClose} />
      </div>
    </ContextMenu>
  )
}
