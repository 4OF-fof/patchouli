import {
  type Accessor,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import type { NewNote, OpenOptions, OwnApi } from '../../plugins/sdk'
import type { Backend, ItemPatch, PluginWork } from '../backend'
import type { UrlPreview } from '../components/editor/NoteEditor/NoteEditor'
import type { HoverHost } from '../components/media/HoverPreview/HoverPreview'
import type { Selection } from '../components/media/Selection/Selection'
import type { MenuAt } from '../components/media/Thumb/Thumb'
import type { Blocker } from '../components/media/Unsupported/Unsupported'
import { asNewTab } from '../components/nav/TabPane/newTab'
import { Toast, type ToastLevel } from '../components/overlay/Toast/Toast'
import { type Item, type Library, type Suggestion, withChanged, withSuggestions } from '../model/library'
import { flush as flushWrites } from '../model/persist'
import type { MenuGroup, ScreenInfo } from '../plugins/types'
import type { BarRequest } from '../screens/AppBar'
import { embedOf as embedFor } from '../screens/Note/embed'
import { libraryItemOf } from '../screens/Plugin/libraryItem'
import { PluginScreen } from '../screens/Plugin/PluginScreen'
import { ITEMS, REPLY, STATE, type FromWindow, type Reply, type WindowCall, type WindowState } from '../window/protocol'
import { messageOf } from './notice'
import { LABEL, type View } from './view'

/** 設定と残した値を持てないときに、プラグインの画面に渡す窓口。 */
const NO_OWN: OwnApi = {
  settings: async () => ({}),
  setSetting: async () => {},
  getData: async () => undefined,
  setData: async () => {},
}

const workCount = (w?: PluginWork) => (w ? w.thumbnails.length + w.waveforms.length : 0)

/** 待っている書き込みを終えてから読み込み直す。 */
export const reload = () => void flushWrites().finally(() => window.location.reload())

export const openWith = (opts: OpenOptions | undefined, open: () => void) => (opts?.newTab ? asNewTab(open) : open())

export interface PluginsDeps {
  backend: Backend
  lib: Accessor<Library>
  setLib: (l: Library) => void
  screens: Accessor<ScreenInfo[]>
  setScreens: (s: ScreenInfo[]) => void
  setPinnedProjects: (n: string[]) => void
  setPinnedTags: (t: string[]) => void
  selection: Selection
  screenOfView: (v: View & { s: 'screen' }) => ScreenInfo | undefined
  go: (v: View) => void
  openItem: (id: string) => void
  addNoteWith: (n: NewNote) => Promise<Item | undefined>
  editItem: (id: string, change: Partial<Item>, patch: ItemPatch) => void
  setTags: (id: string, tags: string[]) => void
  renameItem: (id: string, name: string) => void
  /** 読み込み直したライブラリに重ねる自動分類の提案。 */
  suggestions: () => Record<string, Suggestion> | undefined
  setBarRequest: (r: BarRequest) => void
  notify: (message: string, level: ToastLevel) => void
  failOpen: (e: unknown) => void
}

/** プラグインの右クリックのメニュー・画面・ウィンドウ・読み込み直しと形式の衝突の知らせ。 */
export function createPlugins(d: PluginsDeps) {
  const { backend, lib, setLib, screens, setScreens, setPinnedProjects, setPinnedTags, selection, screenOfView } = d
  const { go, openItem, addNoteWith, editItem, setTags, renameItem, setBarRequest, notify, failOpen } = d
  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => notify(done, 'success'),
      (e: unknown) => notify(`コピーに失敗しました：${messageOf(e)}`, 'error'),
    )
  const [menu, setMenu] = createSignal<MenuAt & { ids: string[] }>()
  const [menuPlugins, setMenuPlugins] = createSignal<MenuGroup[]>()
  // 選んでいないものを右クリックしたときは、選択を外してそれだけにかける
  const openMenu = (id: string, at: MenuAt) => {
    if (at.anchor && menu()?.anchor === at.anchor) {
      setMenu(undefined)
      return
    }
    const ids = selection.has(id) ? selection.ids() : [id]
    if (!selection.has(id)) selection.clear()
    const m = { ids, ...at }
    setMenu(m)
    setMenuPlugins(undefined)
    if (!backend.itemMenu) return
    backend.itemMenu(ids).then(
      (es) => menu() === m && setMenuPlugins(es),
      (e: unknown) => console.warn('プラグインのメニューを読めない', e),
    )
  }
  const [menuResult, setMenuResult] = createSignal<{ title: string; rows: { label: string; value: string }[] }>()
  const runPlugin = (ids: string[], plugin: string, entry: string) => {
    const label = menuPlugins()
      ?.find((g) => g.plugin === plugin)
      ?.items.find((e) => e.id === entry)?.label
    return backend.runItemMenu?.(ids, plugin, entry).then(
      (r) => {
        if (r.items.length) setLib(withChanged(lib(), r.items, []))
        if (r.copy !== undefined)
          navigator.clipboard
            .writeText(r.copy)
            .catch((e: unknown) => notify(`コピーに失敗しました：${messageOf(e)}`, 'error'))
        if (r.failed.length) {
          console.warn('プラグインが頼んだ処理のうち、できなかったもの', r.failed)
          notify(`プラグインの処理の一部に失敗しました：${r.failed[0]}`, 'error')
        } else if (r.output && 'toast' in r.output) notify(r.output.toast, r.output.level ?? 'info')
        else if (r.saved) notify(`「${r.saved}」に書き出しました`, 'success')
        if (r.output && 'overlay' in r.output)
          setMenuResult({ title: r.output.overlay.title ?? label ?? 'プラグインの結果', rows: r.output.overlay.rows })
        if (r.output && 'screen' in r.output) {
          const { id, window } = r.output.screen
          const s = screens().find((x) => x.plugin === plugin && x.id === id)
          if (s) void openScreen(s, ids, window === true).catch(failOpen)
          else notify(`プラグインの画面「${id}」が見つかりません`, 'error')
        }
      },
      (e: unknown) => notify(`プラグインの処理に失敗しました：${messageOf(e)}`, 'error'),
    )
  }

  const pluginScreen = (v: View & { s: 'screen' }) => {
    const s = screenOfView(v)
    return (
      <PluginScreen
        lib={lib()}
        url={s && backend.uiUrl?.(s)}
        screen={v.id}
        targets={v.targets ?? []}
        label={s?.label ?? LABEL.screen}
        own={backend.ownApi?.(v.plugin) ?? NO_OWN}
        onOpen={(id, o) => openWith(o, () => openItem(id))}
        onOpenTag={(tag, o) => openWith(o, () => go({ s: 'tag', tag }))}
        onOpenProject={(name, o) => openWith(o, () => go({ s: 'project', name }))}
        onCreateNote={addNoteWith}
        onBody={(id, body) => editItem(id, { body }, { body })}
        onTags={setTags}
        onRename={renameItem}
      />
    )
  }
  /** 画面のウィンドウ（label → 出しているもの）。ライブラリはこちらが持ち、ウィンドウには写しを送る。 */
  const screenWins = new Map<string, { screen: ScreenInfo; targets: string[] }>()
  const pinSet = createMemo(() => new Set(lib().pins))
  const windowItems = () => lib().items.map((it) => libraryItemOf(it, pinSet()))
  const sendState = (label: string) => {
    const w = screenWins.get(label)
    if (!w) return
    const ws: WindowState = {
      plugin: w.screen.plugin,
      screen: w.screen.id,
      label,
      url: backend.uiUrl?.(w.screen) ?? '',
      items: windowItems(),
      targets: w.targets,
    }
    void backend.screenWindows?.send(label, STATE, ws)
  }
  /** 別のウィンドウで開けないときは、タブで開く。 */
  const openScreen = async (s: ScreenInfo, targets: string[], inWindow: boolean) => {
    const sw = backend.screenWindows
    if (!inWindow || !sw) {
      go({ s: 'screen', plugin: s.plugin, id: s.id, ...(targets.length && { targets }) })
      return
    }
    const { label, existed } = await sw.open(s)
    screenWins.set(label, { screen: s, targets })
    if (existed) sendState(label)
  }
  createEffect(() => {
    lib()
    untrack(() => {
      if (!screenWins.size) return
      const items = windowItems()
      for (const label of screenWins.keys()) void backend.screenWindows?.send(label, ITEMS, items)
    })
  })
  const needItem = (id: string) => {
    const it = lib().byId.get(id)
    if (!it) throw new Error(`項目「${id}」が見つかりません`)
    return it
  }
  const toFront = (o: OpenOptions | undefined, open: () => void) => {
    openWith(o, open)
    backend.screenWindows?.focusMain()
  }
  const windowCall = async (plugin: string, c: WindowCall): Promise<Omit<Reply, 'req'>> => {
    const own = backend.ownApi?.(plugin) ?? NO_OWN
    switch (c.method) {
      case 'settings':
        return { settings: await own.settings() }
      case 'getData':
        return { data: await own.getData(c.args[0]) }
      case 'setSetting':
        await own.setSetting(c.args[0], c.args[1])
        break
      case 'setData':
        await own.setData(c.args[0], c.args[1] ?? undefined)
        break
      case 'open':
        toFront(c.args[1], () => openItem(needItem(c.args[0]).id))
        break
      case 'openTag':
        toFront(c.args[1], () => go({ s: 'tag', tag: c.args[0] }))
        break
      case 'openProject': {
        const [name, o] = c.args
        if (!lib().projectBy.has(name)) throw new Error(`プロジェクト「${name}」が見つかりません`)
        toFront(o, () => go({ s: 'project', name }))
        break
      }
      case 'createNote': {
        const n = c.args[0]
        if (n.project != null && !lib().projectBy.has(n.project))
          throw new Error(`プロジェクト「${n.project}」が見つかりません`)
        const it = await addNoteWith(n)
        if (!it) throw new Error('ノートを作成できませんでした')
        return { item: libraryItemOf(lib().byId.get(it.id) ?? it, pinSet()) }
      }
      case 'setBody': {
        const [id, body] = c.args
        if (!needItem(id).note) throw new Error('ノートではありません')
        editItem(id, { body }, { body })
        break
      }
      case 'setTags':
        needItem(c.args[0])
        setTags(c.args[0], c.args[1])
        break
      case 'rename':
        needItem(c.args[0])
        renameItem(c.args[0], c.args[1])
        break
    }
    return {}
  }
  const onWindow = (m: FromWindow) => {
    const w = screenWins.get(m.label)
    if (!w) return
    if (m.kind === 'closed') {
      screenWins.delete(m.label)
      return
    }
    if (m.kind === 'ready') {
      sendState(m.label)
      return
    }
    const reply = (r: Omit<Reply, 'req'>) => void backend.screenWindows?.send(m.label, REPLY, { req: m.req, ...r })
    windowCall(w.screen.plugin, m).then(reply, (e: unknown) => reply({ error: messageOf(e) }))
  }
  onMount(() => {
    const off = backend.screenWindows?.listen(onWindow)
    if (off) onCleanup(off)
  })
  const embedHost = () => ({
    format: (ext: string) => lib().formats.get(ext),
    view: backend.itemView,
    waveform: backend.waveform,
    ui: backend.uiApi,
    uiUrl: backend.uiUrl,
    linkOf: backend.linkOf,
  })
  const embedOf = (it: Item) => embedFor(it, embedHost())
  const urlPreviewOf = async (url: string): Promise<UrlPreview> => {
    const [page, thumb] = await Promise.all([
      backend
        .linkOf?.(url, 'details')
        .page()
        .catch(() => undefined),
      backend.linkThumb?.(url).catch(() => undefined),
    ])
    return { title: page?.title, thumb }
  }
  /** 設定に合わせて、内蔵ブラウザ（新しい画面）か既定のアプリで開く。 */
  const openUrl = async (url: string) => {
    const s = await backend.appSettings?.get().catch(() => undefined)
    if (s?.linkOpen === 'builtin' || !backend.openUrl) go({ s: 'web', url })
    else await backend.openUrl(url).catch(failOpen)
  }

  const [plugged, setPlugged] = createSignal(0)
  const [reloading, setReloading] = createSignal<{ step: 'ask' | 'wait' | 'load'; work?: number; quiet?: boolean }>()
  let answer: ((a: 'wait' | 'stop') => void) | undefined
  /** quiet のときは、読み込んでいるあいだの表示を出さない。 */
  const reloadPlugins = async (quiet?: boolean) => {
    if (!backend.reloadPlugins) {
      reload()
      return
    }
    if (reloading()) return
    const work = workCount(await backend.pluginWork?.())
    let wait = true
    if (work > 0) {
      setReloading({ step: 'ask', work })
      const a = await new Promise<'wait' | 'stop'>((r) => (answer = r))
      answer = undefined
      wait = a === 'wait'
    }
    setReloading({ step: wait && work > 0 ? 'wait' : 'load', quiet })
    const poll = window.setInterval(() => {
      if (reloading()?.step === 'wait')
        void backend
          .pluginWork?.()
          .then((w) => reloading()?.step === 'wait' && setReloading({ step: 'wait', work: workCount(w) }))
    }, 500)
    try {
      const o = await backend.reloadPlugins(wait)
      const suggestions = d.suggestions()
      setLib(suggestions ? withSuggestions(o.lib, suggestions) : o.lib)
      setScreens(o.screens ?? [])
      setPinnedProjects(o.pinnedProjects)
      setPinnedTags(o.pinnedTags)
      setPlugged(plugged() + 1)
      if (o.problems.length) {
        console.warn('読めなかったもの', o.problems)
        notify(`${o.problems.length} 件を読み込めませんでした`, 'error')
      }
    } catch (e) {
      notify(`プラグインの読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      clearInterval(poll)
      setReloading(undefined)
    }
  }

  const blockerOf = async (ext: string): Promise<Blocker | undefined> => {
    const report = await backend.plugins()
    const clash = report.conflicts?.find((c) => c.ext === ext)
    const clashing = clash && report.plugins.filter((p) => clash.plugins.includes(p.id))
    const [first] = clashing ?? []
    if (clashing && first) return { ...first, conflict: clashing.map((p) => p.name) }
    const of = report.plugins.filter((p) => p.formats.includes(ext))
    return (
      of.find((p) => p.state === 'disabled' && !p.dev) ??
      of.find((p) => p.state === 'disabled') ??
      of.find((p) => p.state === 'blocked')
    )
  }
  const setEnabled = backend.pluginActions?.setEnabled
  const enablePlugin =
    setEnabled &&
    (async (p: Blocker) => {
      await setEnabled(p.id, p.dev, true)
      await reloadPlugins(true)
    })
  const viewHost = backend.itemView && {
    view: backend.itemView,
    ui: backend.uiApi,
    waveform: backend.waveform,
    details: backend.itemDetails,
    linkOf: backend.linkOf,
    browser: backend.browser,
    openUrl: backend.openUrl && ((url: string) => void backend.openUrl?.(url).catch(failOpen)),
    openLink: (url: string) => void openUrl(url),
  }
  const { uiApi, uiUrl, itemView, linkOf } = backend
  const hoverHost: HoverHost = {
    ui:
      uiApi &&
      uiUrl &&
      ((it, ui) => ({
        url: uiUrl(ui),
        api: uiApi({ id: it.id, name: it.name, ext: it.ext, url: it.src }, 'hover', ui.plugin),
      })),
    link:
      itemView &&
      linkOf &&
      (async (it) => {
        const v = await itemView(it.id)
        return v?.kind === 'link' ? linkOf(v.url, 'hover').ui : undefined
      }),
  }

  const [report] = createResource(plugged, () => backend.plugins().catch(() => undefined))
  const [ignoredClash, setIgnoredClash] = createSignal<ReadonlySet<string>>(new Set())
  const clashes = createMemo(() => {
    const r = report()
    return (r?.conflicts ?? []).flatMap((c) => {
      if (ignoredClash().has(c.ext)) return []
      const by = r?.plugins.filter((p) => c.plugins.includes(p.id)) ?? []
      return by.length ? [{ ext: c.ext, by }] : []
    })
  })
  const clashNotice = () => {
    const [c, ...rest] = clashes()
    if (!c) return undefined
    const skip = () => setIgnoredClash(new Set([...ignoredClash(), c.ext]))
    const names = c.by.map((p) => `「${p.name}」`).join('')
    const more = rest.length ? `（ほか ${rest.length} 件の形式にもあります）` : ''
    const [first] = c.by
    return (
      <Toast
        level="warning"
        message={`「.${c.ext}」に複数のプラグイン（${names}）が対応しているため、使用していません${more}`}
        actionLabel="修正"
        onAction={() => {
          skip()
          setBarRequest({ state: 'plugins', plugin: first && { id: first.id, dev: first.dev } })
        }}
        onClose={skip}
        closeLabel="無視"
      />
    )
  }
  return {
    copy,
    menu,
    setMenu,
    menuPlugins,
    openMenu,
    menuResult,
    setMenuResult,
    runPlugin,
    pluginScreen,
    embedHost,
    embedOf,
    urlPreviewOf,
    plugged,
    reloading,
    reloadPlugins,
    answerReload: (a: 'wait' | 'stop') => answer?.(a),
    blockerOf,
    enablePlugin,
    viewHost,
    hoverHost,
    clashes,
    clashNotice,
  }
}
