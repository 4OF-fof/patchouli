import { Show, createEffect, createMemo, on } from 'solid-js'
import type { LibraryItem, NewNote, OpenOptions, OwnApi, ScreenApi } from '../../../plugins/sdk'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { PluginView } from '../../components/media/PluginView/PluginView'
import type { Item, Library } from '../../model/library'
import shared from '../screen.module.css'
import styles from './PluginScreen.module.css'
import { libraryItemOf } from './libraryItem'

export interface PluginScreenProps {
  lib: Library
  /** 画面を描くスクリプトの URL。ないときは、プラグインが有効でないことを出す。 */
  url?: string
  /** plugin.json の screens の id。 */
  screen: string
  /** 右クリックメニューから開いたときに選んでいたものの ID。 */
  targets: string[]
  label: string
  own: OwnApi
  onOpen: (id: string, opts?: OpenOptions) => void
  onOpenTag: (tag: string, opts?: OpenOptions) => void
  onOpenProject: (name: string, opts?: OpenOptions) => void
  /** 作れなかったときは undefined。 */
  onCreateNote: (note: NewNote) => Promise<Item | undefined>
  onBody: (id: string, body: string) => void
  onTags: (id: string, tags: string[]) => void
  onRename: (id: string, name: string) => void
}

export function PluginScreen(props: PluginScreenProps) {
  const pins = createMemo(() => new Set(props.lib.pins))
  const itemOf = (it: Item): LibraryItem => libraryItemOf(it, pins())
  const items = createMemo(() => props.lib.items.map(itemOf))
  const subs = new Set<() => void>()
  createEffect(
    on(
      () => props.lib,
      () => {
        for (const fn of subs) fn()
      },
      { defer: true },
    ),
  )
  const need = (id: string) => {
    const it = props.lib.byId.get(id)
    if (!it) throw new Error(`項目「${id}」が見つかりません`)
    return it
  }
  const api: ScreenApi = {
    ...props.own,
    targets: () => props.targets.flatMap((id) => api.item(id) ?? []),
    items: () => items(),
    item: (id) => {
      const it = props.lib.byId.get(id)
      return it && itemOf(it)
    },
    onChange: (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    open: (id, opts) => props.onOpen(need(id).id, opts),
    openTag: (tag, opts) => props.onOpenTag(tag, opts),
    openProject: (name, opts) => {
      if (!props.lib.projectBy.has(name)) throw new Error(`プロジェクト「${name}」が見つかりません`)
      props.onOpenProject(name, opts)
    },
    createNote: async (note = {}) => {
      if (note.project !== undefined && !props.lib.projectBy.has(note.project))
        throw new Error(`プロジェクト「${note.project}」が見つかりません`)
      const it = await props.onCreateNote(note)
      if (!it) throw new Error('ノートを作成できませんでした')
      return itemOf(props.lib.byId.get(it.id) ?? it)
    },
    setBody: (id, body) => {
      const it = need(id)
      if (!it.note) throw new Error(`「${it.name}」はノートではありません`)
      if (it.body !== body) props.onBody(id, body)
    },
    setTags: (id, tags) => {
      need(id)
      props.onTags(id, [...new Set(tags.map((t) => t.trim()).filter(Boolean))])
    },
    rename: (id, name) => {
      need(id)
      const n = name.trim()
      if (!n) throw new Error('名前が空です')
      props.onRename(id, n)
    },
  }
  return (
    <section class={shared.screen} aria-label={props.label}>
      <Show
        when={props.url}
        fallback={
          <div class={styles.none}>
            <NoneText>この画面を追加したプラグインが有効ではありません</NoneText>
          </div>
        }
      >
        {(url) => <PluginView url={url()} api={api} screen={props.screen} class={styles.view} />}
      </Show>
    </section>
  )
}
