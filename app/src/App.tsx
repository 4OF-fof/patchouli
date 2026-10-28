import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import {
  type Backend,
  type Dropped,
  type Imported,
  type ItemPatch,
  type LibraryState,
  type PluginWork,
  sampleBackend,
} from './backend'
import { DropZone } from './components/overlay/DropZone/DropZone'
import { ReloadOverlay } from './components/overlay/ReloadOverlay/ReloadOverlay'
import { ImportDialog } from './components/dialog/ImportDialog/ImportDialog'
import { Toast } from './components/overlay/Toast/Toast'
import { Peek } from './components/overlay/Peek/Peek'
import {
  type Item,
  type Library,
  newNoteName,
  newProjectName,
  refsOf,
  retag,
  retaggedItems,
  toggled,
  withAdded,
  withChanged,
  withItem,
  withProject,
  withRenamedTag,
  type Thumbnail,
  withThumbs,
  withToggledPin,
} from './model/library'
import { FormatsProvider } from './plugins/formats'
import { type HoverHost, HoverHostProvider } from './components/media/HoverPreview/HoverPreview'
import { PINNED_PROJECTS, PINNED_TAGS } from './samples/library'
import type { Activity } from './components/nav/ActivityButton/ActivityButton'
import type { IconName } from './components/base/Icon/Icon'
import { ThumbMakingProvider } from './components/media/Thumb/Thumb'
import { AllScreen } from './screens/All/AllScreen'
import { AppBar, type BarRequest, type Place } from './screens/AppBar'
import type { Blocker } from './components/media/Unsupported/Unsupported'
import { AssetScreen } from './screens/Asset/AssetScreen'
import { EditionScreen } from './screens/Edition/EditionScreen'
import { NoteScreen } from './screens/Note/NoteScreen'
import type { Embed, NoteEditorApi } from './components/editor/NoteEditor/NoteEditor'
import { ProjectScreen } from './screens/Project/ProjectScreen'
import { ProjectListScreen } from './screens/ProjectList/ProjectListScreen'
import { ScreenFrame } from './screens/ScreenFrame'
import { TagScreen } from './screens/Tag/TagScreen'
import { TagListScreen } from './screens/TagList/TagListScreen'
import { TidyScreen } from './screens/Tidy/TidyScreen'

type View =
  | { s: 'edition' }
  | { s: 'all' }
  | { s: 'project'; name: string; editing?: boolean }
  | { s: 'plist' }
  | { s: 'tlist' }
  | { s: 'tag'; tag: string }
  | { s: 'note'; id: string }
  | { s: 'asset'; list: string[]; index: number }
  | { s: 'tidy'; id?: string }

const LABEL: Record<View['s'], string> = {
  edition: 'ホーム',
  all: 'すべて',
  project: 'プロジェクト',
  plist: 'プロジェクト一覧',
  tlist: 'タグ一覧',
  tag: 'タグ',
  note: 'ノート',
  asset: '素材',
  tidy: '整理',
}

export interface AppProps {
  lib: Library
  backend?: Backend
  pinnedProjects?: string[]
  pinnedTags?: string[]
  location?: string
  notice?: string
}

const importedNotice = (r: Imported) => {
  const n = r.items.length
  const parts = [n ? `${n} 件を取り込みました` : '取り込めるファイルがありませんでした']
  if (r.projects.length) parts.push(`プロジェクト ${r.projects.length} 件`)
  if (r.skipped) parts.push(`${r.skipped} 件はライブラリ内のファイルなどのためスキップ`)
  if (r.failed.length) parts.push(`${r.failed.length} 件のコピーに失敗`)
  return parts.join('、')
}

const workCount = (w?: PluginWork) => (w ? w.thumbnails.length + w.waveforms.length : 0)

// 作り始めてから頼まれた素材を覚えておき、途中で増えたら total も増やす
function progress() {
  const [ids, setIds] = createSignal<ReadonlySet<string>>(new Set())
  const [seen, setSeen] = createSignal(0)
  let all = new Set<string>()
  const update = (now: string[]) => {
    if (!now.length) all = new Set()
    for (const id of now) all.add(id)
    if (now.length !== ids().size || now.some((id) => !ids().has(id))) setIds(new Set(now))
    setSeen(all.size)
  }
  return { ids, done: () => seen() - ids().size, total: seen, update }
}
type Progress = ReturnType<typeof progress>

export function App(props: AppProps) {
  const backend = props.backend ?? sampleBackend()
  const [lib, setLib] = createSignal(props.lib)
  const [stack, setStack] = createSignal<View[]>([{ s: 'edition' }])
  const [pinnedProjects, setPinnedProjects] = createSignal(props.pinnedProjects ?? PINNED_PROJECTS)
  const [pinnedTags, setPinnedTags] = createSignal(props.pinnedTags ?? PINNED_TAGS)
  const [notice, setNotice] = createSignal(props.notice)
  const view = () => stack().at(-1) ?? { s: 'edition' }
  const labelOf = (v: View) =>
    v.s === 'project'
      ? v.name
      : v.s === 'tag'
        ? `# ${v.tag}`
        : v.s === 'note'
          ? (lib().byId.get(v.id)?.name ?? LABEL.note)
          : v.s === 'asset'
            ? (lib().byId.get(v.list[v.index] ?? '')?.name ?? LABEL.asset)
            : LABEL[v.s]
  const crumbs = () => stack().map(labelOf)
  const go = (v: View) => setStack([...stack(), v])
  const goBack = () => setStack(stack().length > 1 ? stack().slice(0, -1) : stack())
  const openItem = (id: string, list?: string[]) => {
    const it = lib().byId.get(id)
    if (!it) return
    if (it.note) {
      go({ s: 'note', id })
      return
    }
    const l = (list ?? [id]).filter((x) => lib().byId.get(x)?.note === false)
    go({ s: 'asset', list: l, index: Math.max(0, l.indexOf(id)) })
  }
  const [peek, setPeek] = createSignal<string>()
  const openRef = (id: string) => {
    if (lib().byId.has(id)) setPeek(id)
  }
  createEffect(() => {
    stack()
    setPeek(undefined)
  })
  const onGo = (to: Place) => {
    if (to === 'tidy') go({ s: 'tidy' })
    else setStack([{ s: to === 'all' ? 'all' : to === 'tags' ? 'tlist' : to === 'projects' ? 'plist' : 'edition' }])
  }

  let queue = Promise.resolve()
  const fail = (e: unknown) => {
    setNotice(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`)
  }
  const persist = (job: () => Promise<void>) => {
    queue = queue.then(job).catch(fail)
  }
  const state = (): LibraryState => ({
    pins: lib().pins,
    pinnedProjects: pinnedProjects(),
    pinnedTags: pinnedTags(),
    tagCovers: Object.fromEntries(lib().tagCovers),
  })
  const saveState = () => {
    const s = state()
    persist(() => backend.saveState(s))
  }
  // 文章が外で変わっていて書かなかったときは、読み直したものに替える
  const saveItem = (id: string, patch: ItemPatch) =>
    persist(async () => {
      const it = await backend.saveItem(id, patch)
      if (!it) return
      setLib(withChanged(lib(), [it], []))
      setNotice('外で変更されたので読み込み直しました')
    })

  const editItem = (id: string, change: Partial<Item>, patch: ItemPatch) => {
    const it = lib().byId.get(id)
    if (!it) return
    setLib(withChanged(lib(), [{ ...it, ...change }], []))
    saveItem(id, patch)
  }
  const [recentTags, setRecentTags] = createSignal<string[]>([])
  const tagItem = (id: string, tag: string, on: boolean) => {
    const tags = lib().byId.get(id)?.tags ?? []
    if (on) setRecentTags([tag, ...recentTags().filter((t) => t !== tag)].slice(0, 8))
    editItem(
      id,
      { tags: on ? [...tags, tag] : tags.filter((t) => t !== tag) },
      { tags: on ? { add: [tag] } : { remove: [tag] } },
    )
  }
  // 先に画面を変えておき、ファイルを変えられなかったら元に戻す
  const changeFile = (id: string, change: Partial<Item>, undo: Partial<Item>, run: () => Promise<Item | undefined>) => {
    const put = (c: Partial<Item>) => {
      const now = lib().byId.get(id)
      if (now) setLib(withChanged(lib(), [{ ...now, ...c }], []))
    }
    put(change)
    persist(async () => {
      try {
        const done = await run()
        if (done) setLib(withChanged(lib(), [done], []))
      } catch (e) {
        put(undo)
        throw e
      }
    })
  }
  const moveItem = (id: string, folder: string | null) => {
    const it = lib().byId.get(id)
    if (it && it.folder !== folder)
      changeFile(id, { folder }, { folder: it.folder }, () => backend.moveItem(id, folder))
  }
  const renameItem = (id: string, name: string) => {
    const it = lib().byId.get(id)
    if (it && it.name !== name) changeFile(id, { name }, { name: it.name }, () => backend.renameItem(id, name))
  }

  const createProject = async () => {
    const name = newProjectName(lib())
    try {
      setLib(withProject(lib(), await backend.createProject(name)))
      go({ s: 'project', name, editing: true })
    } catch (e) {
      fail(e)
    }
  }
  const addNote = async (name: string | undefined, folder: string | null) => {
    try {
      const it = await backend.createNote(newNoteName(lib(), name), folder)
      setLib(withItem(lib(), it))
      return it
    } catch (e) {
      fail(e)
      return undefined
    }
  }
  const createNote = async (name?: string) => {
    const it = await addNote(name, null)
    if (it) go({ s: 'note', id: it.id })
  }
  const embedOf = async (it: Item): Promise<Embed | undefined> => {
    const v = await backend.itemView?.(it.id).catch(() => null)
    // 読み解いた画像の URL は次に開いた素材で捨てられるので、本文ではサムネイルを使う
    if (v?.kind === 'image' && !v.url && it.src) return { kind: 'image', src: it.src }
    if (v?.kind === 'image' && it.thumb) return { kind: 'image', src: it.thumb }
    if ((v?.kind === 'video' || v?.kind === 'audio') && it.src) return { kind: v.kind, src: it.src }
    return { kind: 'card', thumb: it.thumb }
  }
  const renameTag = (from: string, to: string) => {
    const re = retag(from, to)
    const before = lib()
    const after = withRenamedTag(before, from, to)
    setLib(after)
    setPinnedTags([...new Set(pinnedTags().map(re))])
    setStack(stack().map((v) => (v.s === 'tag' ? { ...v, tag: re(v.tag) } : v)))
    for (const it of retaggedItems(before, after)) {
      const old = before.byId.get(it.id)?.tags ?? []
      saveItem(it.id, {
        tags: { add: it.tags.filter((t) => !old.includes(t)), remove: old.filter((t) => !it.tags.includes(t)) },
      })
    }
    saveState()
  }
  const chooseLibrary =
    backend.chooseLibrary &&
    (async () => {
      try {
        if (await backend.chooseLibrary?.()) window.location.reload()
      } catch (e) {
        setNotice(`ライブラリを切り替えられませんでした：${e instanceof Error ? e.message : String(e)}`)
      }
    })
  const [plugged, setPlugged] = createSignal(0)
  const [reloading, setReloading] = createSignal<{ step: 'ask' | 'wait' | 'load'; work?: number }>()
  let answer: ((a: 'wait' | 'stop') => void) | undefined
  const reloadPlugins = async () => {
    if (!backend.reloadPlugins) return window.location.reload()
    if (reloading()) return
    const work = workCount(await backend.pluginWork?.())
    let wait = true
    if (work > 0) {
      setReloading({ step: 'ask', work })
      const a = await new Promise<'wait' | 'stop'>((r) => (answer = r))
      answer = undefined
      wait = a === 'wait'
    }
    setReloading({ step: wait && work > 0 ? 'wait' : 'load' })
    const poll = window.setInterval(() => {
      if (reloading()?.step === 'wait')
        void backend
          .pluginWork?.()
          .then((w) => reloading()?.step === 'wait' && setReloading({ step: 'wait', work: workCount(w) }))
    }, 500)
    try {
      const o = await backend.reloadPlugins(wait)
      setLib(o.lib)
      setPinnedProjects(o.pinnedProjects)
      setPinnedTags(o.pinnedTags)
      setPlugged(plugged() + 1)
      if (o.problems.length) {
        console.warn('読めなかったもの', o.problems)
        setNotice(`${o.problems.length} 件を読み込めませんでした`)
      }
    } catch (e) {
      setNotice(`プラグインの読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      clearInterval(poll)
      setReloading(undefined)
    }
  }
  const assetIndex = new WeakMap<View, number>()
  const [barRequest, setBarRequest] = createSignal<BarRequest>()
  const blockerOf = async (ext: string): Promise<Blocker | undefined> => {
    const of = (await backend.plugins()).plugins.filter((p) => p.formats.includes(ext))
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
      await reloadPlugins()
    })
  const viewHost = backend.itemView && {
    view: backend.itemView,
    ui: backend.uiApi,
    waveform: backend.waveform,
    details: backend.itemDetails,
  }
  const { uiApi, uiUrl } = backend
  const hoverHost: HoverHost = {
    ui:
      uiApi &&
      uiUrl &&
      ((it, ui) => ({
        url: uiUrl(ui),
        api: uiApi({ id: it.id, name: it.name, ext: it.ext, url: it.src }, 'hover', ui.plugin),
      })),
  }
  const togglePin = (id: string) => {
    setLib(withToggledPin(lib(), id))
    saveState()
  }
  const toggleProjectPin = (name: string) => {
    setPinnedProjects(toggled(pinnedProjects(), name))
    saveState()
  }
  const toggleTagPin = (tag: string) => {
    setPinnedTags(toggled(pinnedTags(), tag))
    saveState()
  }
  const here = (): Place | undefined =>
    view().s === 'edition'
      ? 'home'
      : view().s === 'all'
        ? 'all'
        : view().s === 'tlist'
          ? 'tags'
          : view().s === 'plist'
            ? 'projects'
            : undefined

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable || e.target.closest('input, textarea, select, [role="dialog"], [role="menu"]'))
    )
      return
    if (e.key === 'Escape') {
      if (peek()) setPeek(undefined)
      else goBack()
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      go({ s: 'tidy' })
    }
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  // サムネイルは 1 枚ずつ届くので、少し溜めてからまとめて付ける
  let thumbs = new Map<string, Thumbnail>()
  let flush = 0
  const stopThumbs = backend.onThumbnail((id, t) => {
    thumbs.set(id, t)
    flush ||= window.setTimeout(() => {
      setLib(withThumbs(lib(), thumbs))
      thumbs = new Map()
      flush = 0
    }, 150)
  })
  onCleanup(() => {
    stopThumbs()
    clearTimeout(flush)
  })

  const stopChanged =
    backend.onChanged?.((c) => {
      const s = c.state
      setLib(
        withChanged(
          lib(),
          c.items,
          c.removed,
          c.projects,
          s?.tagCovers && new Map(Object.entries(s.tagCovers)),
          s?.pins,
        ),
      )
      if (s?.pinnedProjects) setPinnedProjects(s.pinnedProjects)
      if (s?.pinnedTags) setPinnedTags(s.pinnedTags)
      if (c.problems.length) {
        console.warn('読めなかったもの', c.problems)
        setNotice(`${c.problems.length} 件を読み込めませんでした`)
      }
    }) ?? (() => {})
  onCleanup(stopChanged)

  const [drag, setDrag] = createSignal<Dropped>()
  const [asking, setAsking] = createSignal<Dropped>()
  const dropFolder = () => {
    const v = view()
    return v.s === 'project' ? v.name : null
  }
  const [importing, setImporting] = createSignal(0)
  const importDropped = async (projects: number[], folder = dropFolder()) => {
    if (!backend.importDropped) return []
    setImporting(importing() + 1)
    try {
      const r = await backend.importDropped(folder, projects)
      if (r.failed.length) console.warn('取り込めなかったもの', r.failed)
      setLib(withAdded(lib(), r.items, r.projects))
      setNotice(importedNotice(r))
      return r.items
    } catch (e) {
      setNotice(`取り込めませんでした：${e instanceof Error ? e.message : String(e)}`)
      return []
    } finally {
      setImporting(importing() - 1)
    }
  }
  const importFiles = async (files: File[], folder: string | null) => {
    const take = backend.importData
    if (!take) return []
    setImporting(importing() + 1)
    try {
      const done = await Promise.allSettled(files.map((f) => take(f, folder)))
      const items = done.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const failed = done.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      if (failed.length) console.warn('取り込めなかったもの', failed)
      setLib(withAdded(lib(), items))
      if (failed.length) setNotice(`${failed.length} 件の取り込みに失敗しました`)
      return items
    } finally {
      setImporting(importing() - 1)
    }
  }
  let noteEditor: NoteEditorApi | undefined
  const intoNote = () => {
    const v = view()
    return v.s === 'note' && noteEditor && !peek()
      ? { editor: noteEditor, folder: lib().byId.get(v.id)?.folder ?? null }
      : undefined
  }
  const stopDrag =
    backend.onFileDrag?.((e) => {
      const into = intoNote()
      if (e.type === 'enter') setDrag(e.dropped)
      else if (e.type === 'over') into?.editor.dropAt(e)
      else if (e.type === 'drop') {
        const d = drag()
        setDrag(undefined)
        into?.editor.dropAt(undefined)
        if (!d?.files) return
        const at = { x: e.x, y: e.y }
        if (into) void importDropped([], into.folder).then((items) => into.editor.insertItems(items, at))
        else if (d.folders.length) setAsking(d)
        else void importDropped([])
      } else if (e.type === 'leave') {
        setDrag(undefined)
        into?.editor.dropAt(undefined)
      }
    }) ?? (() => {})
  onCleanup(stopDrag)
  const making = progress()
  const waves = progress()
  const [checking, setChecking] = createSignal(false)
  if (backend.pluginWork || backend.checking) {
    const poll = window.setInterval(() => {
      void backend.pluginWork?.().then((w) => {
        making.update(w.thumbnails)
        waves.update(w.waveforms)
      })
      void backend.checking?.().then(setChecking)
    }, 1000)
    onCleanup(() => clearInterval(poll))
  }
  const working = (key: string, icon: IconName, label: string, p: Progress, part: 'thumbnail' | 'waveform') =>
    p.ids().size
      ? [{ key, icon, label, done: p.done(), total: p.total(), onStop: () => void backend.stopPluginWork?.(part) }]
      : []
  const activities = (): Activity[] => [
    ...(checking() ? [{ key: 'check', icon: 'sync' as const, label: 'ライブラリの整合性を確認中' }] : []),
    ...working('thumbs', 'image', 'サムネイルを作成中', making, 'thumbnail'),
    ...working('waves', 'audio', '音声を解析中', waves, 'waveform'),
    ...(importing() ? [{ key: 'import', icon: 'import' as const, label: 'ファイルを取り込み中' }] : []),
  ]
  const flatSub = () => {
    const f = dropFolder()
    return f ? `ドロップして「${f}」に追加します` : 'ドロップしてプロジェクト未指定で取り込みます'
  }

  const noteScreen = (noteId: string, main: boolean) => (
    <NoteScreen
      lib={lib()}
      noteId={noteId}
      headsOpen={main ? undefined : false}
      onOpenRef={openRef}
      onTogglePin={togglePin}
      onBody={(id, body) => editItem(id, { body }, { body })}
      onRename={renameItem}
      onCreateNote={addNote}
      embedOf={embedOf}
      onImport={backend.importData && importFiles}
      editorRef={main ? (api) => (noteEditor = api) : undefined}
    />
  )
  const assetScreen = (list: string[], index: number, onIndex?: (i: number) => void) => (
    <AssetScreen
      lib={lib()}
      list={list}
      index={index}
      onIndex={onIndex}
      onOpenNote={(id) => openItem(id)}
      onTogglePin={togglePin}
      onProject={moveItem}
      onRename={renameItem}
      onTag={tagItem}
      recentTags={recentTags()}
      onMemo={(id, memo) => editItem(id, { memo }, { memo })}
      host={viewHost}
      blocker={blockerOf}
      onEnablePlugin={enablePlugin}
      onOpenPlugins={(p) => setBarRequest({ state: 'plugins', plugin: p && { id: p.id, dev: p.dev } })}
      onReveal={backend.revealItem}
      onOpenDefault={backend.openItemDefault}
    />
  )

  const [ignored, setIgnored] = createSignal<ReadonlySet<string>>(new Set())
  const ignore = (id: string) => setIgnored(new Set([...ignored(), id]))
  const broken = createMemo(() => {
    const v = view()
    const open = new Set([v.s === 'note' ? v.id : '', peek() ?? ''])
    return lib().items.flatMap((it) => {
      if (!it.note || open.has(it.id) || ignored().has(it.id)) return []
      const lost = new Set(refsOf(it.body ?? '').filter((id) => !lib().byId.has(id)))
      return lost.size ? [{ note: it, lost: lost.size }] : []
    })
  })
  const brokenNotice = () => {
    const [b, ...rest] = broken()
    if (!b) return undefined
    const more = rest.length ? `（ほか ${rest.length} 件のノートにもあります）` : ''
    return (
      <Toast
        message={`「${b.note.name}」に、見つからないリンクが ${b.lost} 件あります${more}`}
        actionLabel="修正"
        onAction={() => {
          ignore(b.note.id)
          openItem(b.note.id)
        }}
        onClose={() => ignore(b.note.id)}
        closeLabel="無視"
      />
    )
  }

  return (
    <FormatsProvider value={() => lib().formats}>
      <ThumbMakingProvider value={(id) => making.ids().has(id) || waves.ids().has(id)}>
        <HoverHostProvider value={hoverHost}>
          <ScreenFrame
            bar={
              <AppBar
                lib={lib()}
                here={here()}
                crumbs={crumbs()}
                onBack={stack().length > 1 ? goBack : undefined}
                onCrumb={(i) => setStack(stack().slice(0, i + 1))}
                onGo={onGo}
                onOpenProject={(name) => go({ s: 'project', name })}
                onOpenItem={(id) => openItem(id)}
                onCreate={createNote}
                library={props.location}
                onChooseLibrary={chooseLibrary}
                libraries={backend.libraries}
                tidy={backend.tidy}
                developer={backend.developer}
                onReopen={() => window.location.reload()}
                loadPlugins={() => backend.plugins()}
                pluginActions={backend.pluginActions}
                onPluginsChanged={reloadPlugins}
                request={barRequest()}
                activities={activities()}
              />
            }
            toast={
              (notice() || broken().length > 0) && (
                <>
                  {notice() && <Toast message={notice()} onClose={() => setNotice(undefined)} />}
                  {brokenNotice()}
                </>
              )
            }
          >
            {/* プラグインを読み直したら、組み込み UI を描き直すため、いまの画面を作り直す */}
            <For each={[plugged()]}>
              {() => (
                <Switch>
                  <Match when={view().s === 'edition'}>
                    <EditionScreen
                      lib={lib()}
                      location={props.location}
                      pinnedProjects={pinnedProjects()}
                      pinnedTags={pinnedTags()}
                      onOpenItem={(id) => openItem(id)}
                      onOpenProject={(name) => go({ s: 'project', name })}
                      onOpenTag={(tag) => go({ s: 'tag', tag })}
                      onTidy={(id) => go({ s: 'tidy', id })}
                    />
                  </Match>
                  <Match when={view().s === 'all'}>
                    <AllScreen lib={lib()} onOpenItem={openItem} onTogglePin={togglePin} />
                  </Match>
                  <Match when={view().s === 'project' && view()} keyed>
                    {(v) =>
                      v.s === 'project' && (
                        <ProjectScreen
                          lib={lib()}
                          name={v.name}
                          editing={v.editing}
                          pinned={pinnedProjects().includes(v.name)}
                          onTogglePin={togglePin}
                          onToggleProjectPin={() => toggleProjectPin(v.name)}
                          onOpenItem={openItem}
                        />
                      )
                    }
                  </Match>
                  <Match when={view().s === 'plist'}>
                    <ProjectListScreen
                      lib={lib()}
                      pinned={pinnedProjects()}
                      onOpenProject={(name) => go({ s: 'project', name })}
                      onCreate={createProject}
                    />
                  </Match>
                  <Match when={view().s === 'tlist'}>
                    <TagListScreen lib={lib()} onOpenTag={(tag) => go({ s: 'tag', tag })} />
                  </Match>
                  <Match when={view().s === 'tag' && view()} keyed>
                    {(v) =>
                      v.s === 'tag' && (
                        <TagScreen
                          lib={lib()}
                          tag={v.tag}
                          pinned={pinnedTags().includes(v.tag)}
                          onOpenItem={openItem}
                          onOpenTag={(tag) => go({ s: 'tag', tag })}
                          onTogglePin={togglePin}
                          onToggleTagPin={() => toggleTagPin(v.tag)}
                          onRename={(to) => renameTag(v.tag, to)}
                        />
                      )
                    }
                  </Match>
                  <Match when={view().s === 'note' && view()} keyed>
                    {(v) => v.s === 'note' && noteScreen(v.id, true)}
                  </Match>
                  <Match when={view().s === 'asset' && view()} keyed>
                    {(v) =>
                      v.s === 'asset' && assetScreen(v.list, assetIndex.get(v) ?? v.index, (i) => assetIndex.set(v, i))
                    }
                  </Match>
                  <Match when={view().s === 'tidy' && view()} keyed>
                    {(v) =>
                      v.s === 'tidy' && <TidyScreen lib={lib()} currentId={v.id} onOpenItem={(id) => openItem(id)} />
                    }
                  </Match>
                </Switch>
              )}
            </For>
            <Show when={peek()}>
              {(id) => (
                <Peek
                  label={lib().byId.get(id())?.name ?? ''}
                  onExpand={() => {
                    const to = id()
                    setPeek(undefined)
                    openItem(to)
                  }}
                  onClose={() => setPeek(undefined)}
                >
                  <Show when={id()} keyed>
                    {(to) => (lib().byId.get(to)?.note ? noteScreen(to, false) : assetScreen([to], 0))}
                  </Show>
                </Peek>
              )}
            </Show>
            <Show when={reloading()}>
              {(r) => (
                <ReloadOverlay
                  step={r().step}
                  work={r().work}
                  onWait={() => answer?.('wait')}
                  onStop={() => (r().step === 'ask' ? answer?.('stop') : void backend.stopPluginWork?.())}
                />
              )}
            </Show>
            <Show when={!intoNote() && drag()}>
              {(d) => (
                <DropZone
                  title={d().files ? `${d().files} 件のファイルを取り込む` : '取り込めるファイルがありません'}
                  sub={
                    !d().files
                      ? 'ライブラリ内のファイルと空のフォルダは取り込めません'
                      : d().folders.length
                        ? 'ドロップ後にフォルダごとの取り込み方法を選択できます'
                        : flatSub()
                  }
                />
              )}
            </Show>
            <Show when={asking()}>
              {(d) => (
                <ImportDialog
                  files={d().files}
                  folders={d().folders}
                  loose={d().loose}
                  into={dropFolder() ?? undefined}
                  onImport={(projects) => {
                    setAsking(undefined)
                    void importDropped(projects)
                  }}
                  onClose={() => setAsking(undefined)}
                />
              )}
            </Show>
          </ScreenFrame>
        </HoverHostProvider>
      </ThumbMakingProvider>
    </FormatsProvider>
  )
}
