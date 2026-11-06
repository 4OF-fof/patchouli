import { type Accessor, createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import type { Backend } from '../backend'
import type { Selection } from '../components/media/Selection/Selection'
import type { NavMenuItem } from '../components/nav/NavMenu/NavMenu'
import { asNewTab, inNewTab } from '../components/nav/TabPane/newTab'
import { type Item, type Library, samePlace } from '../model/library'
import { prefs, screenStart } from '../model/prefs'
import type { ScreenInfo } from '../plugins/types'
import type { Place, ScreenPlace } from '../screens/AppBar'
import { type Tab, type View, screenIcon } from './view'

export interface NavigationDeps {
  backend: Backend
  lib: Accessor<Library>
  screens: Accessor<ScreenInfo[]>
  selection: Selection
  stack: () => View[]
  setStack: (s: View[]) => void
  eachStack: (f: (s: View[]) => View[]) => void
  openTab: (views: View[]) => void
  assetIndex: (v: View & { s: 'asset' }) => number
  persist: (job: () => Promise<void>) => void
  failLoad: (e: unknown) => void
}

const screenPlace = (v: View) => (v.s === 'screen' ? screenStart(v.plugin, v.id) : undefined)
export const placeOfView = (v: View): Place | undefined =>
  v.s === 'edition'
    ? 'home'
    : v.s === 'all'
      ? 'all'
      : v.s === 'tlist'
        ? 'tags'
        : v.s === 'plist'
          ? 'projects'
          : screenPlace(v)

/** 画面を開く・戻る・横から覗く（Peek）と、最近開いたもの。 */
export function createNavigation(d: NavigationDeps) {
  const { backend, lib, screens, selection, stack, setStack, eachStack, openTab, assetIndex, persist, failLoad } = d
  const view = () => stack().at(-1) ?? { s: 'edition' }

  const go = (v: View) => (inNewTab() ? openTab([...stack(), v]) : setStack([...stack(), v]))
  const itemView = (id: string, list?: string[], at?: number): View | undefined => {
    const it = lib().byId.get(id)
    if (!it) return undefined
    if (it.note) return { s: 'note', id }
    const l = (list ?? [id]).filter((x) => lib().byId.get(x)?.note === false)
    return { s: 'asset', list: l, index: Math.max(0, l.indexOf(id)), at }
  }
  const openGroup = (id: string) => go({ s: 'group', id })
  const openItem = (id: string, list?: string[], at?: number) => {
    const v = itemView(id, list, at)
    if (v) go(v)
  }
  /** パンくずの段から切り替えられる、同じ種類の仲間。来た道によらず、その段の画面だけで決める */
  const siblingItems = (v: View): Item[] | undefined => {
    if (v.s === 'asset') {
      const list = v.list.flatMap((id) => lib().byId.get(id) ?? [])
      return list.length > 1 ? list : undefined
    }
    const n = v.s === 'note' ? lib().byId.get(v.id) : undefined
    return n && lib().items.filter((it) => samePlace(it, n))
  }
  const siblingsOf = (t: Tab, i: number): NavMenuItem[] | undefined => {
    const v = t.stack()[i]
    if (!v) return undefined
    const here = v.s === 'note' ? v.id : v.s === 'asset' ? v.list[assetIndex(v)] : undefined
    const group = v.s === 'group' ? lib().groupBy.get(v.id) : undefined
    const list: NavMenuItem[] | undefined =
      v.s === 'project'
        ? lib().projects.map((pr) => ({ id: pr.name, icon: 'project', label: pr.name, current: v.name === pr.name }))
        : v.s === 'tag'
          ? [...lib().tagGroups().keys()]
              .toSorted((a, b) => a.localeCompare(b, 'ja'))
              .map((tag) => ({ id: tag, icon: 'hash', label: tag, current: v.tag === tag }))
          : group
            ? lib()
                .groupsIn({ project: group.project, group: group.parent })
                .map((g) => ({ id: g.id, icon: 'group', label: g.name, current: g.id === group.id }))
            : siblingItems(v)?.map((it) => ({
                id: it.id,
                icon: it.note ? 'note' : 'file',
                label: it.name,
                current: it.id === here,
              }))
    return list?.toSorted((a, b) => Number(!!b.current) - Number(!!a.current))
  }
  const toSibling = (t: Tab, i: number, id: string) => {
    const v = t.stack()[i]
    if (!v) return
    const to: View | undefined =
      v.s === 'project'
        ? { s: 'project', name: id }
        : v.s === 'tag'
          ? { s: 'tag', tag: id }
          : v.s === 'group'
            ? { s: 'group', id }
            : itemView(
                id,
                siblingItems(v)?.map((it) => it.id),
              )
    if (to) t.setStack([...t.stack().slice(0, i), to])
  }
  const [peek, setPeek] = createSignal<string>()
  const [peekUrl, setPeekUrl] = createSignal<string>()
  const openRef = (id: string) => {
    const how = prefs().openLink
    if (inNewTab() || how === 'here') openItem(id)
    else if (how === 'tab') asNewTab(() => openItem(id))
    else if (lib().byId.has(id)) {
      setPeekUrl(undefined)
      setPeek(id)
    }
  }
  /** URL の埋め込み。素材のリンクと同じく、開き方の設定に合わせる。 */
  const openPage = (url: string) => {
    const how = prefs().openLink
    if (inNewTab() || how === 'here') go({ s: 'web', url })
    else if (how === 'tab') asNewTab(() => go({ s: 'web', url }))
    else {
      setPeek(undefined)
      setPeekUrl(url)
    }
  }

  createEffect(() => {
    stack()
    setPeek(undefined)
    setPeekUrl(undefined)
    selection.clear()
  })
  const onGo = (to: Place) => {
    const screen = screens().find((s) => screenStart(s.plugin, s.id) === to)
    if (screen) setStack([{ s: 'screen', plugin: screen.plugin, id: screen.id }])
    else if (to === 'tidy') go({ s: 'tidy' })
    else setStack([{ s: to === 'all' ? 'all' : to === 'tags' ? 'tlist' : to === 'projects' ? 'plist' : 'edition' }])
  }

  const OPENED = 20
  const [opened, setOpened] = createSignal<string[]>([])
  // 読み終える前に開いたものは、先頭に残す
  onMount(
    () =>
      void backend
        .openHistory?.()
        .then((ids) => setOpened([...new Set([...opened(), ...ids])].slice(0, OPENED)), failLoad),
  )
  let saveOpened: ReturnType<typeof setTimeout> | undefined
  // 素材を送って見るたびに書かないよう、少し待ってから残す
  createEffect(() => {
    const v = stack().at(-1)
    const id = v?.s === 'note' ? v.id : v?.s === 'asset' ? v.list[assetIndex(v)] : undefined
    const list = untrack(opened)
    if (!id || list[0] === id) return
    const next = [id, ...list.filter((x) => x !== id)].slice(0, OPENED)
    setOpened(next)
    clearTimeout(saveOpened)
    saveOpened = setTimeout(() => persist(async () => backend.saveOpenHistory?.(next)), 1000)
  })
  onCleanup(() => clearTimeout(saveOpened))

  const withoutItem = (vs: View[], id: string) =>
    vs.flatMap((v): View[] => {
      if (v.s === 'note') return v.id === id ? [] : [v]
      if (v.s !== 'asset' || !v.list.includes(id)) return [v]
      const at = assetIndex(v)
      const list = v.list.filter((x) => x !== id)
      if (!list.length) return []
      const cur = v.list[at]
      return [{ ...v, list, index: cur === id ? Math.min(at, list.length - 1) : list.indexOf(cur ?? '') }]
    })
  // 先に頼んだ保存が、ごみ箱に移動したあとでメタ情報を書き直さないよう、保存と同じ順番に並べる
  /** 消えた項目を、タブ・Peek・選択から外す。 */
  const forget = (ids: string[]) => {
    for (const id of ids) {
      eachStack((s) => {
        const rest = withoutItem(s, id)
        // 変わらないタブはそのままにする。タブを戻す前に呼ばれても、操作されたと見なさないように
        if (rest.length === s.length && rest.every((v, i) => v === s[i])) return s
        return rest.length ? rest : [{ s: 'edition' }]
      })
      if (peek() === id) setPeek(undefined)
    }
    selection.set(selection.ids().filter((id) => lib().byId.has(id)))
  }

  const screenPlaces = (): ScreenPlace[] =>
    screens()
      .filter((s) => s.place)
      .map((s) => ({ place: screenStart(s.plugin, s.id), label: s.label, icon: screenIcon(s) }))

  const goPlace = (id: string) => {
    if (id === 'home' || id === 'all' || id === 'tags' || id === 'projects') onGo(id)
    const s = screenPlaces().find((x) => x.place === id)
    if (s) onGo(s.place)
  }
  return {
    view,
    go,
    openGroup,
    openItem,
    siblingsOf,
    toSibling,
    peek,
    setPeek,
    peekUrl,
    setPeekUrl,
    openRef,
    openPage,
    onGo,
    opened,
    forget,
    screenPlaces,
    goPlace,
  }
}
