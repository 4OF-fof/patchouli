import {
  For,
  Match,
  Show,
  Switch,
  children,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import { type Backend, type Orphan, type ThumbApplied, sampleBackend } from './backend'
import type { RemoteAsk, RemotePermission } from './backend/types'
import { RemoteAskDialog } from './components/dialog/RemoteAskDialog/RemoteAskDialog'
import { RemoteToasts } from './app/RemoteToasts'
import { DropZone } from './components/overlay/DropZone/DropZone'
import { ReloadOverlay } from './components/overlay/ReloadOverlay/ReloadOverlay'
import { DeleteDialog } from './components/dialog/DeleteDialog/DeleteDialog'
import { MenuResultDialog } from './components/dialog/MenuResultDialog/MenuResultDialog'
import { OrphanDialog } from './components/dialog/OrphanDialog/OrphanDialog'
import { TagGoneDialog } from './components/dialog/TagGoneDialog/TagGoneDialog'
import { TagMergeDialog } from './components/dialog/TagMergeDialog/TagMergeDialog'
import { Toast } from './components/overlay/Toast/Toast'
import { Peek } from './components/overlay/Peek/Peek'
import { ItemMenu } from './components/overlay/ItemMenu/ItemMenu'
import { type Library, hasTag, noteRefs, tagClash } from './model/library'
import { FormatsProvider } from './plugins/formats'
import type { ScreenInfo } from './plugins/types'
import { HoverHostProvider } from './components/media/HoverPreview/HoverPreview'
import { asNewTab } from './components/nav/TabPane/newTab'
import { TabPane } from './components/nav/TabPane/TabPane'
import { PaneMenu } from './components/nav/SplitView/PaneMenu'
import { PaneHead } from './components/nav/PaneHead/PaneHead'
import { liftTab } from './components/nav/TabStrip/liftTab'
import { paneWith, swappedIn } from './components/nav/SplitView/spaces'
import { Stage } from './components/nav/SplitView/Stage'
import { TabList } from './components/nav/TabList/TabList'
import { TabStrip } from './components/nav/TabStrip/TabStrip'
import { MAIN_HOST, HostProvider } from './window/host'
import { Popout } from './window/Popout'
import { rememberBackground, watchPopouts } from './window/controls'
import { watchViewport } from './window/viewport'
import { applyPrefs, paperOf, prefs, screenStart } from './model/prefs'
import { flush as flushWrites } from './model/persist'
import { SelectionProvider, createSelection } from './components/media/Selection/Selection'
import { ItemMenuProvider, ThumbMakingProvider, ThumbSeenProvider } from './components/media/Thumb/Thumb'
import { AllScreen } from './screens/All/AllScreen'
import { AppBar, type BarRequest, BarToolsProvider } from './screens/AppBar'
import { PlaceBar, placeEntries } from './screens/PlaceBar'
import { AssetScreen } from './screens/Asset/AssetScreen'
import { EditionScreen } from './screens/Edition/EditionScreen'
import { GroupScreen } from './screens/Group/GroupScreen'
import { NoteScreen } from './screens/Note/NoteScreen'
import type { NoteEditorApi } from './components/editor/NoteEditor/NoteEditor'
import { urlEmbedOf as urlEmbedFor } from './screens/Note/embed'
import { WebScreen } from './screens/Web/WebScreen'
import { hostOf } from './plugins/links'
import { ProjectScreen } from './screens/Project/ProjectScreen'
import { ProjectListScreen } from './screens/ProjectList/ProjectListScreen'
import { ScreenFrame } from './screens/ScreenFrame'
import { TagScreen } from './screens/Tag/TagScreen'
import { TagListScreen } from './screens/TagList/TagListScreen'
import { TidyScreen } from './screens/Tidy/TidyScreen'
import { createBackground } from './app/background'
import { createEdits } from './app/edits'
import { createNavigation, placeOfView } from './app/navigation'
import { createNotice, messageOf } from './app/notice'
import { createPlugins, reload } from './app/plugins'
import { createLibraryState } from './app/state'
import { type Tab, type View, createViews, viewOf } from './app/view'
import { MAIN_WIN, createWorkspace, splitSpace } from './app/workspace'

const tabsAt = () => prefs().tabsAt

export interface AppProps {
  lib: Library
  backend?: Backend
  pinnedProjects?: string[]
  pinnedTags?: string[]
  orphans?: Orphan[]
  location?: string
  notice?: string
  screens?: ScreenInfo[]
}

const REVEAL_LABEL = /Mac/.test(navigator.userAgent)
  ? 'Finder で表示'
  : /Windows/.test(navigator.userAgent)
    ? 'エクスプローラーで表示'
    : 'フォルダを開く'

const showPrefs = () => {
  applyPrefs(prefs())
  rememberBackground(paperOf(prefs()))
}

export function App(props: AppProps) {
  const backend = props.backend ?? sampleBackend()
  const { notice, setNotice, notify, fail, failLoad, failOpen, persist } = createNotice()
  const changeThumb = (done: Promise<ThumbApplied | null>) =>
    void done.then(
      (applied) =>
        applied && notify(applied === 'jacket' ? 'ジャケットを変更しました' : 'サムネイルを変更しました', 'success'),
      (e: unknown) => notify(`サムネイルの変更に失敗しました：${messageOf(e)}`, 'error'),
    )
  const { lib, setLib, screens, setScreens, pinnedProjects, setPinnedProjects, pinnedTags, setPinnedTags, saveState } =
    createLibraryState({
      lib: props.lib,
      screens: props.screens,
      pinnedProjects: props.pinnedProjects,
      pinnedTags: props.pinnedTags,
      backend,
      persist,
    })
  const { screenOfView, assetIndexOf, assetIndex, labelOf, iconOf, savedView } = createViews({ lib, screens })
  const startView = (): View => {
    const s = untrack(screens).find((x) => x.place && screenStart(x.plugin, x.id) === prefs().start)
    return s ? { s: 'screen', plugin: s.plugin, id: s.id } : { s: 'edition' }
  }
  const editors = new Map<number, NoteEditorApi>()
  const {
    tabs,
    currentTab,
    setCurrentTab,
    spaces,
    setSpaces,
    spaceOf,
    paneOf,
    winOf,
    shownSpace,
    mainSpace,
    rectOfPane,
    stack,
    setStack,
    eachStack,
    openTab,
    openNewWindow,
    dropPopped,
    hostOfTab,
    stageOfTab,
    setPaneHint,
    hintOfPane,
    dragAway,
    dropTab,
    paneMenu,
    setPaneMenu,
    openPaneMenu,
    openBeside,
    tabEntry,
    tabIn,
    tabStrip,
    paneStrip,
    popped,
    popStages,
    setPopStages,
    setMainStage,
    restoreTabs,
    savedTabs,
    paneLayers,
  } = createWorkspace({ startView, labelOf, iconOf, notify, onTabGone: (id) => editors.delete(id) })
  createEffect(showPrefs)
  onMount(() => onCleanup(watchViewport(window)))
  onMount(() => onCleanup(watchPopouts()))
  onMount(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', showPrefs)
    onCleanup(() => mq.removeEventListener('change', showPrefs))
  })
  const selection = createSelection((ids) => setDeleting(ids))
  if (props.notice) notify(props.notice, 'error')
  const {
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
    openTidy,
    onGo,
    opened,
    forget,
    screenPlaces,
    goPlace,
  } = createNavigation({
    backend,
    lib,
    screens,
    selection,
    stack,
    setStack,
    eachStack,
    openTab,
    assetIndex,
    persist,
    failLoad,
  })
  const {
    editItem,
    recentTags,
    tagItem,
    setAliases,
    moveItem,
    moveItems,
    approveTags,
    undoTags,
    tagItems,
    renameItem,
    deleteItems,
    deleting,
    setDeleting,
    allTags,
    createProject,
    addNote,
    createNote,
    addNoteWith,
    setTags,
    renameTag,
    merging,
    setMerging,
    requestRenameTag,
    saveTagCover,
    deleteTagCover,
    goneTags,
    nextGoneTag,
    saveProjectCover,
    renameProject,
    deleteProject,
    orphans,
    setOrphans,
    orphansHeld,
    setOrphansHeld,
    settleOrphan,
    togglePin,
    pinItems,
    toggleProjectPin,
    toggleTagPin,
  } = createEdits({
    backend,
    lib,
    setLib,
    pinnedProjects,
    setPinnedProjects,
    pinnedTags,
    setPinnedTags,
    saveState,
    selection,
    eachStack,
    go,
    forget,
    orphans: props.orphans,
    persist,
    notify,
    fail,
    failLoad,
  })
  const { suggestions, drag, importFiles, making, waves, seenThumbs, activities, flatSub, intoNote } = createBackground(
    {
      backend,
      lib,
      setLib,
      setPinnedProjects,
      setPinnedTags,
      setOrphans,
      setOrphansHeld,
      tabs,
      currentTab,
      view,
      peek,
      editors,
      approveTags,
      forget,
      notify,
    },
  )
  const [barRequest, setBarRequest] = createSignal<BarRequest>()
  const {
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
    noteSyntax,
    cardHost,
    plugged,
    reloading,
    reloadPlugins,
    answerReload,
    blockerOf,
    enablePlugin,
    viewHost,
    hoverHost,
    clashes,
    clashNotice,
  } = createPlugins({
    backend,
    lib,
    setLib,
    screens,
    setScreens,
    setPinnedProjects,
    setPinnedTags,
    selection,
    screenOfView,
    go,
    openItem,
    addNoteWith,
    editItem,
    setTags,
    renameItem,
    suggestions,
    setBarRequest,
    notify,
    failOpen,
  })
  const webScreen = (url: string) => (
    <WebScreen
      url={url}
      browser={backend.browser}
      onOpenDefault={backend.openUrl && ((u) => void backend.openUrl?.(u).catch(failOpen))}
    />
  )

  const chooseLibrary =
    backend.chooseLibrary &&
    (async () => {
      try {
        await flushWrites()
        if (await backend.chooseLibrary?.()) window.location.reload()
      } catch (e) {
        notify(`ライブラリの切り替えに失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    })
  // 前に開いていたタブを戻してから、変わるたびに書き出す
  const [tabsRead, setTabsRead] = createSignal(!backend.tabs)
  onMount(
    () =>
      void backend
        .tabs?.()
        .then((s) => restoreTabs(s, (v, from) => viewOf(lib(), screens(), v, from)), failLoad)
        .finally(() => setTabsRead(true)),
  )
  createEffect(() => {
    const s = savedTabs(savedView)
    const save = backend.saveTabs
    if (tabsRead() && save) persist(() => save(s))
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable || e.target.closest('input, textarea, select, [role="dialog"], [role="menu"]'))
    )
      return
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'u') {
      e.preventDefault()
      onGo('tidy')
    } else if (k === 'n' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void createNote()
    }
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const [asks, setAsks] = createSignal<RemoteAsk[]>([])
  const addAsks = (list: RemoteAsk[]) =>
    setAsks((now) => [...now, ...list.filter((a) => !now.some((b) => b.id === a.id))])
  onMount(() => {
    const r = backend.remote
    if (!r) return
    onCleanup(r.onAsk((a) => addAsks([a])))
    onCleanup(r.onAskClosed((id) => setAsks((now) => now.filter((a) => a.id !== id))))
    onCleanup(r.onOpen((id) => asNewTab(() => openItem(id))))
    void r.asks().then(addAsks, failLoad)
  })
  const answerAsk = (a: RemoteAsk, permissions: RemotePermission[] | undefined) => {
    setAsks((now) => now.filter((b) => b.id !== a.id))
    void backend.remote
      ?.answer(a.id, permissions)
      .catch((e: unknown) => notify(`接続の許可に失敗しました：${messageOf(e)}`, 'error'))
  }

  const editUrl = (id: string, url: string) => editItem(id, { url: url || undefined }, { url })
  const noteScreen = (noteId: string, tab?: Tab) => (
    <NoteScreen
      lib={lib()}
      noteId={noteId}
      headsOpen={tab ? undefined : false}
      onOpenRef={openRef}
      onOpenTag={(tag) => go({ s: 'tag', tag })}
      onTogglePin={togglePin}
      onBody={(id, body) => editItem(id, { body }, { body })}
      onLeave={(id) => void flushWrites().then(() => backend.noteLeft?.(id))}
      onRename={renameItem}
      onMove={moveItem}
      onAliases={setAliases}
      onUrl={editUrl}
      onTag={tagItem}
      recentTags={recentTags()}
      suggestTags={backend.tagDecisions?.suggestTags}
      onCreateNote={addNote}
      embedOf={embedOf}
      urlEmbedOf={(url, image) => urlEmbedFor(url, embedHost(), image)}
      urlPreviewOf={urlPreviewOf}
      syntax={noteSyntax()}
      onOpenPage={openPage}
      onImport={backend.importData && importFiles}
      editorRef={tab ? (api) => (api ? editors.set(tab.id, api) : editors.delete(tab.id)) : undefined}
    />
  )
  const assetScreen = (list: string[], index: number, onIndex?: (i: number) => void, at?: number) => (
    <AssetScreen
      lib={lib()}
      list={list}
      index={index}
      startAt={at}
      onIndex={onIndex}
      onOpenNote={(id) => openItem(id)}
      onOpenTag={(tag) => go({ s: 'tag', tag })}
      onTogglePin={togglePin}
      onMove={moveItem}
      onRename={renameItem}
      onTag={tagItem}
      recentTags={recentTags()}
      suggestTags={backend.tagDecisions?.suggestTags}
      onMemo={(id, memo) => editItem(id, { memo }, { memo })}
      onUrl={editUrl}
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
    const open = new Set([
      ...tabs().flatMap((t) => {
        const v = t.stack().at(-1)
        return v?.s === 'note' ? [v.id] : []
      }),
      peek() ?? '',
    ])
    const l = lib()
    const skip = ignored()
    return l.items.flatMap((it) => {
      if (!it.note || open.has(it.id) || skip.has(it.id)) return []
      const lost = new Set(noteRefs(it).filter((id) => !l.byId.has(id)))
      return lost.size ? [{ note: it, lost: lost.size }] : []
    })
  })
  const brokenNotice = () => {
    const [b, ...rest] = broken()
    if (!b) return undefined
    const more = rest.length ? `（ほか ${rest.length} 件のノートにもあります）` : ''
    return (
      <Toast
        level="warning"
        message={`「${b.note.name}」に、リンク切れが ${b.lost} 件あります${more}`}
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

  /**
   * タブの画面は 1 度だけ作り、出す窓の面に動かす。別のウィンドウに出しても作り直さないので、スクロールや入力の途中が残る。
   * For の中に置くと、For が並べ直すときに元の場所に戻されるので、For には何も返さない。
   */
  const pane = (t: Tab) => {
    const rect = () => {
      const s = spaceOf(t)
      return rectOfPane(s, s && paneWith(s, t.id)?.id)
    }
    const shown = () => {
      const s = spaceOf(t)
      const k = winOf(s)
      return !!s && paneWith(s, t.id)?.active === t.id && s === shownSpace(k) && (k === MAIN_WIN || popStages().has(k))
    }
    const host = createMemo(() => hostOfTab(t), MAIN_HOST, { equals: (a, b) => a.doc === b.doc })
    const [tools, setTools] = createSignal<HTMLElement>()
    const el = children(() => (
      <TabPane
        active={t === currentTab()}
        shown={shown()}
        rect={rect()}
        host={host}
        onFocus={() => currentTab() !== t && setCurrentTab(t)}
        onContextMenu={(e) => openPaneMenu(t, e)}
        head={
          // 分割していないワークスペースではタイトルバーにだけ出し、タブが 1 つだけのペインでは出さない
          <Show when={splitSpace(spaceOf(t)) && (paneOf(t)?.tabs.length ?? 0) > 1 && paneOf(t)}>
            {(p) => <PaneHead {...paneStrip(p())} />}
          </Show>
        }
        bar={
          <PlaceBar
            crumbs={t.stack().map(labelOf)}
            places={() => placeEntries(lib(), placeOfView(t.stack().at(-1) ?? { s: 'edition' }), screenPlaces())}
            selected={t === currentTab() ? selection.ids().length : 0}
            onCrumb={(i) => t.setStack(t.stack().slice(0, i + 1))}
            siblingsOf={(i) => siblingsOf(t, i)}
            onSibling={(i, id) => toSibling(t, i, id)}
            onPlace={goPlace}
            toolsRef={setTools}
            onGrab={(e) =>
              liftTab(e, tabEntry(t), {
                onAway: (at) => dragAway(t.id, at),
                onDropAway: (x, y) => dropTab(t.id, x, y),
              })
            }
          />
        }
      >
        <BarToolsProvider value={tools}>{screenOf(t)}</BarToolsProvider>
      </TabPane>
    ))
    createEffect(() => {
      const to = stageOfTab(t)
      for (const n of el.toArray()) if (to && n instanceof Node && n.parentNode !== to) to.append(n)
    })
    onCleanup(() => {
      for (const n of el.toArray()) if (n instanceof Element) n.remove()
    })
    return undefined
  }
  const popout = (k: number) => {
    const s = () => shownSpace(k)
    const p = popped().get(k)
    const title = () => {
      const f = tabIn(k)
      return f ? labelOf(f.stack().at(-1) ?? { s: 'edition' }) : 'Patchouli'
    }
    return (
      p && (
        <Popout
          win={p.win}
          frame={p.frame}
          title={title()}
          bar={<TabStrip {...tabStrip(k)} />}
          onStage={(el) =>
            setPopStages((m) => {
              const n = new Map(m)
              if (el) n.set(k, el)
              else n.delete(k)
              return n
            })
          }
          onFocus={() => {
            const f = tabIn(k)
            if (f && spaceOf(currentTab()) !== s()) setCurrentTab(f)
          }}
          onClosed={() => dropPopped(k)}
        >
          {paneLayers(s)}
        </Popout>
      )
    )
  }

  const screenOf = (tab: Tab) => {
    const shown = (): View => tab.stack().at(-1) ?? { s: 'edition' }
    return (
      <Switch>
        <Match when={shown().s === 'edition'}>
          <EditionScreen
            lib={lib()}
            location={props.location}
            pinnedProjects={pinnedProjects()}
            pinnedTags={pinnedTags()}
            onOpenItem={(id) => openItem(id)}
            onOpenProject={(name) => go({ s: 'project', name })}
            onOpenTag={(tag) => go({ s: 'tag', tag })}
            onTidy={openTidy}
          />
        </Match>
        <Match when={shown().s === 'all'}>
          <AllScreen lib={lib()} onOpenItem={openItem} onOpenGroup={openGroup} onTogglePin={togglePin} />
        </Match>
        <Match when={shown().s === 'project' && shown()} keyed>
          {(v) =>
            v.s === 'project' && (
              <ProjectScreen
                lib={lib()}
                name={v.name}
                editing={v.editing}
                pinned={pinnedProjects().includes(v.name)}
                onTogglePin={togglePin}
                onToggleProjectPin={() => toggleProjectPin(v.name)}
                onSaveCover={(cover) => saveProjectCover(v.name, cover)}
                onRename={backend.renameProject && ((to) => renameProject(v.name, to))}
                onDelete={backend.deleteProject && (() => deleteProject(v.name))}
                onOpenItem={openItem}
                onOpenGroup={openGroup}
                cards={cardHost()}
              />
            )
          }
        </Match>
        <Match when={shown().s === 'group' && shown()} keyed>
          {(v) =>
            v.s === 'group' && (
              <GroupScreen
                lib={lib()}
                id={v.id}
                onTogglePin={togglePin}
                onOpenItem={openItem}
                onOpenGroup={openGroup}
              />
            )
          }
        </Match>
        <Match when={shown().s === 'plist'}>
          <ProjectListScreen
            lib={lib()}
            pinned={pinnedProjects()}
            onOpenProject={(name) => go({ s: 'project', name })}
            onCreate={createProject}
          />
        </Match>
        <Match when={shown().s === 'tlist'}>
          <TagListScreen lib={lib()} onOpenTag={(tag) => go({ s: 'tag', tag })} />
        </Match>
        <Match when={shown().s === 'tag' && shown()} keyed>
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
                onRename={(to) => requestRenameTag(v.tag, to)}
                onSaveCover={(cover) => saveTagCover(v.tag, cover)}
                cards={cardHost()}
              />
            )
          }
        </Match>
        <Match when={shown().s === 'note' && shown()} keyed>
          {(v) => v.s === 'note' && noteScreen(v.id, tab)}
        </Match>
        <Match when={shown().s === 'asset' && shown()} keyed>
          {(v) =>
            v.s === 'asset' &&
            assetScreen(
              v.list,
              untrack(() => assetIndex(v)),
              (i) => assetIndexOf(v)[1](i),
              v.at,
            )
          }
        </Match>
        <Match when={shown().s === 'web' && shown()} keyed>
          {(v) => v.s === 'web' && webScreen(v.url)}
        </Match>
        <Match when={shown().s === 'screen' && shown()} keyed>
          {(v) => v.s === 'screen' && pluginScreen(v)}
        </Match>
        <Match when={shown().s === 'tidy' && shown()} keyed>
          {(v) =>
            v.s === 'tidy' && (
              <TidyScreen
                lib={lib()}
                currentId={v.id}
                recentTags={recentTags()}
                onOpenItem={(id) => openItem(id)}
                onApprove={(it, d) => approveTags(it.id, d)}
                onUndo={undoTags}
              />
            )
          }
        </Match>
      </Switch>
    )
  }

  return (
    <FormatsProvider value={() => lib().formats}>
      <ThumbMakingProvider value={(id) => making.ids().has(id) || waves.ids().has(id)}>
        <ThumbSeenProvider value={seenThumbs}>
          <ItemMenuProvider value={{ open: openMenu, anchor: () => menu()?.anchor }}>
            <SelectionProvider value={selection}>
              <HoverHostProvider value={hoverHost}>
                <ScreenFrame
                  bar={
                    <AppBar
                      lib={lib()}
                      onGo={onGo}
                      onOpenProject={(name) => go({ s: 'project', name })}
                      onOpenGroup={openGroup}
                      onOpenTag={(tag) => go({ s: 'tag', tag })}
                      onOpenItem={(id, at) => openItem(id, undefined, at)}
                      recent={opened()}
                      onCreate={createNote}
                      library={props.location}
                      onChooseLibrary={chooseLibrary}
                      libraries={backend.libraries}
                      tidy={backend.tidy}
                      developer={backend.developer}
                      appSettings={backend.appSettings}
                      remote={backend.remote}
                      exportFile={backend.exportFile}
                      autoTag={backend.autoTag}
                      contentSearch={backend.contentSearch}
                      onReopen={reload}
                      loadPlugins={() => backend.plugins()}
                      pluginActions={backend.pluginActions}
                      onPluginsChanged={reloadPlugins}
                      request={barRequest()}
                      activities={activities()}
                      tabs={tabsAt() === 'top' ? tabStrip(MAIN_WIN) : undefined}
                      onNewWindow={openNewWindow}
                      screens={screenPlaces()}
                    />
                  }
                  side={tabsAt() === 'left' ? <TabList {...tabStrip(MAIN_WIN)} /> : undefined}
                  toast={
                    (notice() || broken().length > 0 || clashes().length > 0) && (
                      <>
                        <Show when={notice()} keyed>
                          {(n) => (
                            <Toast
                              message={n.message}
                              level={n.level}
                              onClose={() => setNotice(undefined)}
                              autoClose={n.level === 'info' || n.level === 'success'}
                            />
                          )}
                        </Show>
                        {brokenNotice()}
                        {clashNotice()}
                      </>
                    )
                  }
                >
                  <Stage ref={setMainStage}>{paneLayers(mainSpace)}</Stage>
                  {/* プラグインを読み直したら、組み込み UI を描き直すため、いまの画面を作り直す */}
                  <For each={[plugged()]}>{() => <For each={tabs()}>{pane}</For>}</For>
                  <For each={[...popped().keys()]}>{popout}</For>
                  <Show when={paneMenu()} keyed>
                    {(m) => (
                      <HostProvider value={() => hostOfTab(m.tab)}>
                        <PaneMenu
                          x={m.x}
                          y={m.y}
                          moves={m.moves}
                          onPreview={(to) => setPaneHint(to === undefined ? undefined : hintOfPane(m.space, to))}
                          onMove={(to) => setSpaces(swappedIn(spaces(), m.pane, to))}
                          onClose={() => {
                            setPaneMenu(undefined)
                            setPaneHint(undefined)
                          }}
                        />
                      </HostProvider>
                    )}
                  </Show>
                  <Show when={peek()}>
                    {(id) => (
                      <Peek
                        label={lib().byId.get(id())?.name ?? ''}
                        onExpand={() => {
                          const to = id()
                          setPeek(undefined)
                          const before = new Set(tabs())
                          asNewTab(() => openItem(to))
                          const t = tabs().find((x) => !before.has(x))
                          if (t) setCurrentTab(t)
                        }}
                        onSplit={(side) => {
                          const to = id()
                          setPeek(undefined)
                          openBeside(side, () => openItem(to))
                        }}
                        onClose={() => setPeek(undefined)}
                      >
                        <Show when={id()} keyed>
                          {(to) => (lib().byId.get(to)?.note ? noteScreen(to) : assetScreen([to], 0))}
                        </Show>
                      </Peek>
                    )}
                  </Show>
                  <Show when={peekUrl()} keyed>
                    {(url) => (
                      <Peek
                        label={hostOf(url) ?? url}
                        onExpand={() => {
                          setPeekUrl(undefined)
                          const before = new Set(tabs())
                          asNewTab(() => go({ s: 'web', url }))
                          const t = tabs().find((x) => !before.has(x))
                          if (t) setCurrentTab(t)
                        }}
                        onSplit={(side) => {
                          setPeekUrl(undefined)
                          openBeside(side, () => go({ s: 'web', url }))
                        }}
                        onOpenDefault={backend.openUrl && (() => void backend.openUrl?.(url).catch(failOpen))}
                        onClose={() => setPeekUrl(undefined)}
                      >
                        {webScreen(url)}
                      </Peek>
                    )}
                  </Show>
                  <Show when={reloading()?.step !== 'load' || !reloading()?.quiet ? reloading() : undefined}>
                    {(r) => (
                      <ReloadOverlay
                        step={r().step}
                        work={r().work}
                        onWait={() => answerReload('wait')}
                        onStop={() => (r().step === 'ask' ? answerReload('stop') : void backend.stopPluginWork?.())}
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
                  <Show when={merging()}>
                    {(m) => (
                      <TagMergeDialog
                        from={m().from}
                        to={m().to}
                        count={lib().items.filter((i) => hasTag(i, m().from)).length}
                        covers={tagClash(lib(), m().from, m().to).covers}
                        onMerge={(keepFrom) => {
                          renameTag(m().from, m().to, keepFrom)
                          setMerging(undefined)
                        }}
                        onRename={(to) => requestRenameTag(m().from, to)}
                        onClose={() => setMerging(undefined)}
                      />
                    )}
                  </Show>
                  <Show when={goneTags()[0]}>
                    {(t) => (
                      <TagGoneDialog
                        tag={t()}
                        onDelete={() => {
                          deleteTagCover(t())
                          nextGoneTag()
                        }}
                        onClose={nextGoneTag}
                      />
                    )}
                  </Show>
                  <Show when={!orphansHeld() && orphans().length > 0}>
                    <OrphanDialog
                      orphans={orphans()}
                      onRelink={(meta, to) =>
                        settleOrphan(meta, backend.relinkMeta && (() => backend.relinkMeta!(meta, to)))
                      }
                      onDiscard={(meta) =>
                        settleOrphan(meta, backend.discardMeta && (() => backend.discardMeta!(meta)))
                      }
                      onClose={() => setOrphansHeld(true)}
                    />
                  </Show>
                  <Show when={asks()[0]} keyed>
                    {(a) => <RemoteAskDialog ask={a} onAnswer={(p) => answerAsk(a, p)} />}
                  </Show>
                  <Show when={backend.remote}>
                    {(r) => (
                      <RemoteToasts
                        lib={lib()}
                        remote={r()}
                        recentTags={recentTags()}
                        onMove={moveItem}
                        onTag={tagItem}
                        onOpen={(id) => asNewTab(() => openItem(id))}
                        fail={fail}
                      />
                    )}
                  </Show>
                  <Show when={deleting()} keyed>
                    {(ids) => {
                      const its = createMemo(() => ids.flatMap((id) => lib().byId.get(id) ?? []))
                      return (
                        <Show when={its().length}>
                          <DeleteDialog
                            items={its()}
                            onDelete={() => {
                              deleteItems(its().map((it) => it.id))
                              setDeleting(undefined)
                            }}
                            onClose={() => setDeleting(undefined)}
                          />
                        </Show>
                      )
                    }}
                  </Show>
                  <Show when={menuResult()} keyed>
                    {(r) => (
                      <MenuResultDialog
                        title={r.title}
                        rows={r.rows}
                        onCopy={(v) => void copy(v, 'コピーしました')}
                        onClose={() => setMenuResult(undefined)}
                      />
                    )}
                  </Show>
                  <Show when={menu()} keyed>
                    {(m) => {
                      const its = () => m.ids.flatMap((id) => lib().byId.get(id) ?? [])
                      const ids = () => its().map((it) => it.id)
                      const one = () => (its().length === 1 ? its()[0]?.id : undefined)
                      const { revealItem: reveal, openItemDefault: openDefault, itemPath } = backend
                      // 右クリックしたタブの窓に出す
                      const host = untrack(() => hostOfTab(currentTab()))
                      return (
                        <Show when={its().length}>
                          <HostProvider value={() => host}>
                            <ItemMenu
                              items={its()}
                              x={m.x}
                              y={m.y}
                              anchor={m.anchor}
                              onScreen={!!m.anchor}
                              pinned={ids().filter((id) => lib().pins.includes(id)).length}
                              lib={lib()}
                              tags={allTags()}
                              recentTags={recentTags()}
                              plugins={menuPlugins()}
                              revealLabel={REVEAL_LABEL}
                              onOpen={() => one() && openItem(one()!)}
                              onOpenInTab={() => one() && asNewTab(() => openItem(one()!))}
                              onOpenDefault={openDefault && (() => one() && void openDefault(one()!).catch(failOpen))}
                              onReveal={reveal && (() => one() && void reveal(one()!).catch(failOpen))}
                              onMove={(to) => moveItems(ids(), to)}
                              onTag={(tag, on) => tagItems(ids(), tag, on)}
                              onPin={(on) => pinItems(ids(), on)}
                              onCopyPath={
                                itemPath &&
                                (() =>
                                  void Promise.all(ids().map(itemPath)).then(
                                    (ps) =>
                                      copy(
                                        ps.join('\n'),
                                        ps.length > 1
                                          ? `${ps.length} 件のパスをコピーしました`
                                          : 'パスをコピーしました',
                                      ),
                                    (e: unknown) => notify(`コピーに失敗しました：${messageOf(e)}`, 'error'),
                                  ))
                              }
                              onCopyName={() =>
                                void copy(
                                  its()
                                    .map((it) => it.name)
                                    .join('\n'),
                                  its().length > 1
                                    ? `${its().length} 件の名前をコピーしました`
                                    : '名前をコピーしました',
                                )
                              }
                              onThumbPick={
                                backend.pickThumb && (() => one() && changeThumb(backend.pickThumb!(one()!)))
                              }
                              onThumbPaste={
                                backend.pasteThumb && (() => one() && changeThumb(backend.pasteThumb!(one()!)))
                              }
                              onThumbClear={
                                backend.clearThumb &&
                                (() =>
                                  one() &&
                                  void backend.clearThumb!(one()!).catch((e: unknown) =>
                                    notify(`サムネイルの変更に失敗しました：${messageOf(e)}`, 'error'),
                                  ))
                              }
                              onPlugin={(plugin, entry) => void runPlugin(ids(), plugin, entry)}
                              onDelete={backend.deleteItem && (() => setDeleting(ids()))}
                              onClose={() => menu() === m && setMenu(undefined)}
                            />
                          </HostProvider>
                        </Show>
                      )
                    }}
                  </Show>
                </ScreenFrame>
              </HoverHostProvider>
            </SelectionProvider>
          </ItemMenuProvider>
        </ThumbSeenProvider>
      </ThumbMakingProvider>
    </FormatsProvider>
  )
}
