import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import { type Backend, type Dropped, type Imported, type ItemPatch, type LibraryState, sampleBackend } from './backend'
import { DropZone } from './components/overlay/DropZone/DropZone'
import { ReloadOverlay } from './components/overlay/ReloadOverlay/ReloadOverlay'
import { ImportDialog } from './components/dialog/ImportDialog/ImportDialog'
import { Toast } from './components/overlay/Toast/Toast'
import {
  type Item,
  type Library,
  newNoteName,
  newProjectName,
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
import { ThumbMakingProvider } from './components/media/Thumb/Thumb'
import { AllScreen } from './screens/All/AllScreen'
import { AppBar, type BarRequest, type Place } from './screens/AppBar'
import type { Blocker } from './components/media/Unsupported/Unsupported'
import { AssetScreen } from './screens/Asset/AssetScreen'
import { EditionScreen } from './screens/Edition/EditionScreen'
import { NoteScreen } from './screens/Note/NoteScreen'
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
  /** 変更を書き込む先。省略すると書き込まない（見本）。 */
  backend?: Backend
  pinnedProjects?: string[]
  pinnedTags?: string[]
  /** 開いたライブラリの場所（設定に出す）。 */
  location?: string
  /** 開いたときに出す知らせ。 */
  notice?: string
}

/** 取り込んだあとに出す知らせ。 */
const importedNotice = (r: Imported) => {
  const n = r.items.length
  const parts = [n ? `${n} 件を取り込みました` : '取り込めるファイルがありませんでした']
  if (r.projects.length) parts.push(`プロジェクト ${r.projects.length} 件`)
  if (r.skipped) parts.push(`${r.skipped} 件はライブラリ内のファイルなどのためスキップ`)
  if (r.failed.length) parts.push(`${r.failed.length} 件のコピーに失敗`)
  return parts.join('、')
}

/** 画面をつないで行き来できるようにしたもの。変更は backend に書き込む。 */
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
  const openRef = (name: string) => {
    const it = lib().byName.get(name)
    if (it) openItem(it.id)
  }
  // メニューから行く所は一番上の画面として開き、戻る先を持たない
  const onGo = (to: Place) => {
    if (to === 'tidy') go({ s: 'tidy' })
    else setStack([{ s: to === 'all' ? 'all' : to === 'tags' ? 'tlist' : to === 'projects' ? 'plist' : 'edition' }])
  }

  // 書き込みは出した順に 1 つずつ流し、失敗したら知らせる
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
  const tagItem = (id: string, tag: string, on: boolean) => {
    const tags = lib().byId.get(id)?.tags ?? []
    editItem(
      id,
      { tags: on ? [...tags, tag] : tags.filter((t) => t !== tag) },
      { tags: on ? { add: [tag] } : { remove: [tag] } },
    )
  }
  // 先に画面を移しておき、移せなかったら元のプロジェクトに戻す
  const moveItem = (id: string, folder: string | null) => {
    const it = lib().byId.get(id)
    if (!it || it.folder === folder) return
    const put = (change: Partial<Item>) => {
      const now = lib().byId.get(id)
      if (now) setLib(withChanged(lib(), [{ ...now, ...change }], []))
    }
    put({ folder })
    persist(async () => {
      try {
        const moved = await backend.moveItem(id, folder)
        if (moved) setLib(withChanged(lib(), [moved], []))
      } catch (e) {
        put({ folder: it.folder })
        throw e
      }
    })
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
  const createNote = async (name?: string) => {
    try {
      const it = await backend.createNote(newNoteName(lib(), name), null)
      setLib(withItem(lib(), it))
      go({ s: 'note', id: it.id })
    } catch (e) {
      fail(e)
    }
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
  // ライブラリを替えたら、画面の状態ごと開き直す
  const chooseLibrary =
    backend.chooseLibrary &&
    (async () => {
      try {
        if (await backend.chooseLibrary?.()) window.location.reload()
      } catch (e) {
        setNotice(`ライブラリを切り替えられませんでした：${e instanceof Error ? e.message : String(e)}`)
      }
    })
  // プラグインだけを読み直す。いまいる画面は保ち、ライブラリと形式を差し替える
  const [plugged, setPlugged] = createSignal(0)
  const [reloading, setReloading] = createSignal<{ step: 'ask' | 'wait' | 'load'; work?: number }>()
  let answer: ((a: 'wait' | 'stop') => void) | undefined
  const reloadPlugins = async () => {
    if (!backend.reloadPlugins) return window.location.reload()
    if (reloading()) return
    const work = (await backend.pluginWork?.()) ?? 0
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
        void backend.pluginWork?.().then((n) => reloading()?.step === 'wait' && setReloading({ step: 'wait', work: n }))
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
  /** 素材の画面で、最後に見ていた位置。画面を作り直したときに戻す。 */
  const assetIndex = new WeakMap<View, number>()
  const [barRequest, setBarRequest] = createSignal<BarRequest>()
  /** 形式 ext を受け持つはずで、使えないプラグイン。無効にしたものを先に探す。 */
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
  const viewHost = backend.itemView && { view: backend.itemView, ui: backend.uiApi, waveform: backend.waveform }
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
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [role="dialog"], [role="menu"]'))
      return
    if (e.key === 'Escape') goBack()
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

  // 写しから開いたときは、裏でファイルと突き合わせた違いがあとから届く
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

  // ファイルを持ってきたら受け口を出す。フォルダを含むものは、落としたあとにフォルダごとの入れ方を選ぶ
  const [drag, setDrag] = createSignal<Dropped>()
  const [asking, setAsking] = createSignal<Dropped>()
  /** 落とした先のプロジェクト。プロジェクトの画面ならそこ、ほかはどこにも入れない。 */
  const dropFolder = () => {
    const v = view()
    return v.s === 'project' ? v.name : null
  }
  const [importing, setImporting] = createSignal(0)
  const importDropped = async (projects: number[]) => {
    if (!backend.importDropped) return
    setImporting(importing() + 1)
    try {
      const r = await backend.importDropped(dropFolder(), projects)
      if (r.failed.length) console.warn('取り込めなかったもの', r.failed)
      setLib(withAdded(lib(), r.items, r.projects))
      setNotice(importedNotice(r))
    } catch (e) {
      setNotice(`取り込めませんでした：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(importing() - 1)
    }
  }
  const stopDrag =
    backend.onFileDrag?.((e) => {
      if (e.type === 'enter') setDrag(e.dropped)
      else if (e.type === 'drop') {
        const d = drag()
        setDrag(undefined)
        if (!d?.files) return
        if (d.folders.length) setAsking(d)
        else void importDropped([])
      } else if (e.type === 'leave') setDrag(undefined)
    }) ?? (() => {})
  onCleanup(stopDrag)
  // 裏でサムネイルや波形を作っている残りの数を見張る。total は作り始めてからいちばん多かった数
  const [work, setWork] = createSignal({ left: 0, total: 0 })
  if (backend.pluginWork) {
    const poll = window.setInterval(() => {
      void backend.pluginWork?.().then((left) => {
        const total = left ? Math.max(left, work().total) : 0
        if (left !== work().left || total !== work().total) setWork({ left, total })
      })
    }, 1000)
    onCleanup(() => clearInterval(poll))
  }
  const activities = (): Activity[] => [
    ...(work().left
      ? [
          {
            key: 'thumbs',
            icon: 'image' as const,
            label: 'サムネイルと波形を作成中',
            done: work().total - work().left,
            total: work().total,
          },
        ]
      : []),
    ...(importing() ? [{ key: 'import', icon: 'import' as const, label: 'ファイルを取り込み中' }] : []),
  ]
  const flatSub = () => {
    const f = dropFolder()
    return f ? `ドロップして「${f}」に追加します` : 'ドロップしてプロジェクト未指定で取り込みます'
  }

  return (
    <FormatsProvider value={() => lib().formats}>
      <ThumbMakingProvider value={() => work().left > 0}>
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
            toast={notice() && <Toast message={notice()} onClose={() => setNotice(undefined)} />}
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
                    {(v) =>
                      v.s === 'note' && (
                        <NoteScreen lib={lib()} noteId={v.id} onOpenRef={openRef} onTogglePin={togglePin} />
                      )
                    }
                  </Match>
                  <Match when={view().s === 'asset' && view()} keyed>
                    {(v) =>
                      v.s === 'asset' && (
                        <AssetScreen
                          lib={lib()}
                          list={v.list}
                          index={assetIndex.get(v) ?? v.index}
                          onIndex={(i) => assetIndex.set(v, i)}
                          onOpenNote={(id) => openItem(id)}
                          onTogglePin={togglePin}
                          onProject={moveItem}
                          onTag={tagItem}
                          onMemo={(id, memo) => editItem(id, { memo }, { memo })}
                          host={viewHost}
                          blocker={blockerOf}
                          onEnablePlugin={enablePlugin}
                          onOpenPlugins={(p) =>
                            setBarRequest({ state: 'plugins', plugin: p && { id: p.id, dev: p.dev } })
                          }
                          onReveal={backend.revealItem}
                          onOpenDefault={backend.openItemDefault}
                        />
                      )
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
            <Show when={drag()}>
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
