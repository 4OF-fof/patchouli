import { Match, Switch, createEffect, createSignal } from 'solid-js'
import { type Item, type Library, type Place, placeOf, samePlace } from '../../../model/library'
import { TagPicker } from '../../controls/TagPicker/TagPicker'
import { NavMenu, type NavMenuEntry } from '../../nav/NavMenu/NavMenu'
import { PlaceMenu } from '../../nav/PlaceMenu/PlaceMenu'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import styles from './ItemMenu.module.css'

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
  /** items のうち、ピン留めしている数。 */
  pinned: number
  lib: Library
  tags: string[]
  recentTags: string[]
  plugins?: ItemMenuEntry[]
  revealLabel?: string
  onOpen: () => void
  onOpenDefault?: () => void
  onReveal?: () => void
  onRename: (name: string) => void
  onMove: (place: Place) => void
  onTag: (tag: string, on: boolean) => void
  onPin: (on: boolean) => void
  onCopyPath?: () => void
  onCopyName: () => void
  onPlugin?: (id: string) => void
  onDelete?: () => void
  onClose: () => void
}

type Mode = 'main' | 'move' | 'tag' | 'rename'

const PLUGIN = 'plugin:'

const group = (xs: (NavMenuEntry | false | undefined)[]): NavMenuEntry[] => xs.filter((x): x is NavMenuEntry => !!x)

export function ItemMenu(props: ItemMenuProps) {
  const [mode, setMode] = createSignal<Mode>('main')
  let box!: HTMLDivElement
  createEffect(() => {
    mode()
    queueMicrotask(() => box.querySelector<HTMLElement>('[role="menu"], input')?.focus())
  })
  const n = () => props.items.length
  const one = () => (n() === 1 ? props.items[0] : undefined)
  const allPinned = () => props.pinned === n()
  const main = (): NavMenuEntry[] => {
    const plugins = props.plugins ?? []
    const it = one()
    return [
      ...(it
        ? [
            ...group([
              { id: 'open', icon: it.note ? 'note' : 'file', label: '開く' },
              props.onOpenDefault && { id: 'default', icon: 'external', label: '既定のアプリで開く' },
              props.onReveal && { id: 'reveal', icon: 'folder', label: props.revealLabel ?? 'フォルダを開く' },
            ]),
            'separator' as const,
            { id: 'rename', icon: 'rename' as const, label: '名前を変更' },
          ]
        : []),
      { id: 'move', icon: 'move', label: '移動' },
      { id: 'tag', icon: 'tag', label: 'タグを追加' },
      'separator',
      ...group([
        { id: 'pin', icon: 'pin', label: allPinned() ? 'ピン留めを解除' : 'ピン留め' },
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
    else if (id === 'move' || id === 'tag' || id === 'rename') setMode(id)
    else done(run()[id])
  }
  const run = (): Record<string, (() => void) | undefined> => ({
    open: props.onOpen,
    default: props.onOpenDefault,
    reveal: props.onReveal,
    pin: () => props.onPin(!allPinned()),
    path: props.onCopyPath,
    name: props.onCopyName,
    delete: props.onDelete,
  })
  const [name, setName] = createSignal(one()?.name ?? '')
  const rename = (e: SubmitEvent) => {
    e.preventDefault()
    const to = name().trim()
    done(to && to !== one()?.name ? () => props.onRename(to) : undefined)
  }
  return (
    <ContextMenu x={props.x} y={props.y} onClose={props.onClose}>
      <div ref={box}>
        <Switch>
          <Match when={mode() === 'main'}>
            <NavMenu items={main()} onSelect={onMain} onClose={props.onClose} />
          </Match>
          <Match when={mode() === 'move'}>
            <PlaceMenu
              lib={props.lib}
              title={one() ? '移動' : `${n()} 件を移動`}
              current={current()}
              onPick={(to) => done(() => props.onMove(to))}
              onBack={() => setMode('main')}
              onClose={props.onClose}
            />
          </Match>
          <Match when={mode() === 'tag'}>
            <TagPicker
              tags={common()}
              mixed={mixed()}
              all={props.tags}
              recent={props.recentTags}
              suggested={[]}
              onToggle={props.onTag}
              onClose={props.onClose}
            />
          </Match>
          <Match when={mode() === 'rename'}>
            <form class={styles.rename} onSubmit={rename}>
              <span>名前を変更</span>
              <input
                aria-label="名前"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </form>
          </Match>
        </Switch>
      </div>
    </ContextMenu>
  )
}
