import { Match, Switch, createEffect, createSignal } from 'solid-js'
import type { Item } from '../../../model/library'
import { TagPicker } from '../../controls/TagPicker/TagPicker'
import { NavMenu, type NavMenuEntry } from '../../nav/NavMenu/NavMenu'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import styles from './ItemMenu.module.css'

/** プラグインが足す項目。 */
export interface ItemMenuEntry {
  id: string
  label: string
}

export interface ItemMenuProps {
  item: Item
  x: number
  y: number
  pinned: boolean
  projects: string[]
  tags: string[]
  recentTags: string[]
  plugins?: ItemMenuEntry[]
  revealLabel?: string
  onOpen: () => void
  onOpenDefault?: () => void
  onReveal?: () => void
  onRename: (name: string) => void
  onMove: (folder: string | null) => void
  onTag: (tag: string, on: boolean) => void
  onTogglePin: () => void
  onCopyPath?: () => void
  onCopyName: () => void
  onPlugin?: (id: string) => void
  onDelete?: () => void
  onClose: () => void
}

type Mode = 'main' | 'move' | 'tag' | 'rename'

const NO_PROJECT = ':none:'
const BACK = ':back:'
const PLUGIN = 'plugin:'

const group = (xs: (NavMenuEntry | false | undefined)[]): NavMenuEntry[] => xs.filter((x): x is NavMenuEntry => !!x)

export function ItemMenu(props: ItemMenuProps) {
  const [mode, setMode] = createSignal<Mode>('main')
  let box!: HTMLDivElement
  createEffect(() => {
    mode()
    queueMicrotask(() => box.querySelector<HTMLElement>('[role="menu"], input')?.focus())
  })
  const main = (): NavMenuEntry[] => {
    const plugins = props.plugins ?? []
    return [
      ...group([
        { id: 'open', icon: props.item.note ? 'note' : 'file', label: '開く' },
        props.onOpenDefault && { id: 'default', icon: 'external', label: '既定のアプリで開く' },
        props.onReveal && { id: 'reveal', icon: 'folder', label: props.revealLabel ?? 'フォルダを開く' },
      ]),
      'separator',
      { id: 'rename', icon: 'rename', label: '名前を変更' },
      { id: 'move', icon: 'move', label: 'プロジェクトへ移動' },
      { id: 'tag', icon: 'tag', label: 'タグを追加' },
      'separator',
      ...group([
        { id: 'pin', icon: 'pin', label: props.pinned ? 'ピン留めを解除' : 'ピン留め' },
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
        ? ['separator' as const, { id: 'delete', icon: 'trash' as const, label: '削除', danger: true }]
        : []),
    ]
  }
  const projects = (): NavMenuEntry[] => [
    { id: BACK, icon: 'back', label: 'プロジェクトへ移動', heading: true },
    'separator',
    { id: NO_PROJECT, label: 'プロジェクトなし', current: props.item.folder === null },
    ...props.projects.map((p) => ({ id: p, icon: 'folder' as const, label: p, current: props.item.folder === p })),
  ]
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
    pin: props.onTogglePin,
    path: props.onCopyPath,
    name: props.onCopyName,
    delete: props.onDelete,
  })
  const onProject = (id: string) => {
    if (id === BACK) setMode('main')
    else done(() => props.onMove(id === NO_PROJECT ? null : id))
  }
  const [name, setName] = createSignal(props.item.name)
  const rename = (e: SubmitEvent) => {
    e.preventDefault()
    const n = name().trim()
    done(n && n !== props.item.name ? () => props.onRename(n) : undefined)
  }
  return (
    <ContextMenu x={props.x} y={props.y} onClose={props.onClose}>
      <div ref={box}>
        <Switch>
          <Match when={mode() === 'main'}>
            <NavMenu items={main()} onSelect={onMain} onClose={props.onClose} />
          </Match>
          <Match when={mode() === 'move'}>
            <NavMenu items={projects()} onSelect={onProject} onClose={props.onClose} />
          </Match>
          <Match when={mode() === 'tag'}>
            <TagPicker
              tags={props.item.tags}
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
