import {
  type Accessor,
  type JSX,
  Show,
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  useContext,
} from 'solid-js'
import { version } from '../../package.json'
import appIcon from '../../src-tauri/icons/32x32.png'
import type {
  AppSettingsActions,
  AutoTagActions,
  AutoTagProgress,
  ContentSearch,
  DeveloperActions,
  LibraryActions,
  RemoteActions,
  StartupActions,
  TidyActions,
} from '../backend/types'
import { Icon, type IconName } from '../components/base/Icon/Icon'
import { Spinner } from '../components/base/Spinner/Spinner'
import { TitleBar } from '../components/nav/TitleBar/TitleBar'
import { HelpDialog } from '../components/dialog/HelpDialog/HelpDialog'
import { LibrariesDialog } from '../components/dialog/LibrariesDialog/LibrariesDialog'
import { PluginsDialog } from '../components/dialog/PluginsDialog/PluginsDialog'
import { SettingsDialog, type SettingsPage } from '../components/dialog/SettingsDialog/SettingsDialog'
import { type Activity, ActivityButton } from '../components/nav/ActivityButton/ActivityButton'
import { NavMenu, type NavMenuEntry } from '../components/nav/NavMenu/NavMenu'
import { SearchPalette } from '../components/nav/SearchPalette/SearchPalette'
import { TabStrip, type TabStripProps } from '../components/nav/TabStrip/TabStrip'
import type { Library } from '../model/library'
import { schemes, setSchemes } from '../model/colorScheme'
import { type ScreenStart, prefs, setPrefs, themeOf } from '../model/prefs'
import { builtinReport } from '../plugins/builtin'
import type { PluginActions, PluginReport } from '../plugins/types'
import {
  type Candidate,
  type Chip,
  candidates,
  chipOf,
  commandScore,
  findItems,
  fold,
  markTerms,
  parseQuery,
  recentItems,
} from '../model/search'
import type { Hint } from '../components/nav/SearchPalette/SearchPalette'
import styles from './AppBar.module.css'
import { type Row, SearchResults } from '../components/nav/SearchResults/SearchResults'
import { ResultHeading } from '../components/nav/ResultRow/ResultRow'

export type Place = 'home' | 'all' | 'tags' | 'projects' | 'tidy' | ScreenStart

/** プラグインが足す画面。 */
export interface ScreenPlace {
  place: ScreenStart
  label: string
  icon: IconName
}
export type BarState =
  | 'closed'
  | 'menu'
  | 'search'
  | 'command'
  | 'prompt'
  | 'help'
  | 'plugins'
  | 'libraries'
  | 'settings'

export interface BarRequest {
  state: BarState
  plugin?: { id: string; dev: boolean }
}

export interface AppBarProps {
  lib: Library
  initial?: BarState
  query?: string
  activities?: Activity[]
  onGo?: (to: Place) => void
  onOpenProject?: (name: string) => void
  onOpenGroup?: (id: string) => void
  onOpenTag?: (tag: string) => void
  /** at は、内容での検索で当たった区間の始まり（秒） */
  onOpenItem?: (id: string, at?: number) => void
  /** 最近開いた項目の ID。新しい順。検索欄が空のときに出す */
  recent?: string[]
  onCreate?: (name?: string) => void
  library?: string
  onChooseLibrary?: () => void | Promise<void>
  libraries?: LibraryActions
  tidy?: TidyActions
  developer?: DeveloperActions
  autoTag?: AutoTagActions
  contentSearch?: ContentSearch
  onReopen?: () => void
  loadPlugins?: () => Promise<PluginReport>
  pluginActions?: PluginActions
  onPluginsChanged?: (quiet?: boolean) => void | Promise<void>
  request?: BarRequest
  /** あれば、タイトルバーにワークスペースを並べる。 */
  tabs?: TabStripProps
  /** あれば、メニューから新しいウィンドウを開ける。 */
  onNewWindow?: () => void
  appSettings?: AppSettingsActions
  startup?: StartupActions
  remote?: RemoteActions
  /** ファイルに書き出し、書き出した場所を返す。選ぶのをやめたら undefined。 */
  exportFile?: (name: string, data: string) => Promise<string | undefined>
  screens?: ScreenPlace[]
}

const BarToolsContext = createContext<Accessor<HTMLElement | undefined>>(() => undefined)
export const BarToolsProvider = BarToolsContext.Provider
/** 画面のボタンを、いまの場所の行に出すときの置き場。タブの外（Peek など）では undefined。 */
export const useBarTools = () => useContext(BarToolsContext)

/** バーのボタン。画面がバーに足すボタンも、これで見た目をそろえる。 */
export function BarButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tip?: string }) {
  const [local, rest] = splitProps(props, ['label', 'tip', 'children'])
  return (
    <button type="button" class={styles.ib} aria-label={local.label} data-tip={local.tip ?? local.label} {...rest}>
      {local.children}
    </button>
  )
}

const toggleTheme = () => setPrefs({ theme: themeOf(prefs()) === 'light' ? 'dark' : 'light' })

export function AppBar(props: AppBarProps) {
  const init = props.initial ?? 'closed'
  const [state, setState] = createSignal<BarState>(init)
  // 「>」などを取り除いて同じ値に戻したときも、入力欄を書き直す
  const [query, setQuery] = createSignal(props.query ?? '', { equals: false })
  const [idx, setIdx] = createSignal(0)
  const [pick, setPick] = createSignal<BarRequest['plugin']>()
  const [settingsPage, setSettingsPage] = createSignal<SettingsPage>()
  const openSettings = (page?: SettingsPage) => {
    setSettingsPage(page)
    setState('settings')
  }
  createEffect(() => {
    const r = props.request
    if (!r) return
    setPick(r.plugin)
    setState(r.state)
  })
  const lib = () => props.lib
  const [chips, setChips] = createSignal<Chip[]>([])
  const searching = () => state() === 'search' || state() === 'command' || state() === 'prompt'
  const menuOpen = () => state() === 'menu'
  const close = () => {
    setState('closed')
    setQuery('')
    setChips([])
    setIdx(0)
    setPick(undefined)
  }
  type Command = Extract<Row, { type: 'cmd' }>
  const commands = (): Command[] => [
    { type: 'cmd', icon: 'tag', label: '分類の確認を開く', key: 'Ctrl U', run: () => props.onGo?.('tidy') },
    { type: 'cmd', icon: 'grid', label: 'すべての項目', key: '', run: () => props.onGo?.('all') },
    { type: 'cmd', icon: 'project', label: 'プロジェクト一覧', key: '', run: () => props.onGo?.('projects') },
    { type: 'cmd', icon: 'hash', label: 'タグ一覧', key: '', run: () => props.onGo?.('tags') },
    ...(props.screens ?? []).map((s): Command => ({
      type: 'cmd',
      icon: s.icon,
      label: `${s.label}を開く`,
      key: '',
      run: () => props.onGo?.(s.place),
    })),
    { type: 'cmd', icon: 'newNote', label: '新しいノートを作成', key: 'Ctrl N', run: () => props.onCreate?.() },
    { type: 'cmd', icon: 'home', label: 'ホームに戻る', key: '', run: () => props.onGo?.('home') },
    ...(props.onChooseLibrary
      ? [
          {
            type: 'cmd' as const,
            icon: 'library' as const,
            label: 'ライブラリを切り替え',
            key: '',
            run: () => void onMenu('library'),
          },
        ]
      : []),
    { type: 'cmd', icon: 'plugin', label: 'プラグインを開く', key: '', run: () => setState('plugins') },
    { type: 'cmd', icon: 'settings', label: '設定を開く', key: '', run: () => openSettings() },
    { type: 'cmd', icon: 'keyboard', label: 'ショートカット一覧', key: '', run: () => setState('help') },
    { type: 'cmd', icon: 'theme', label: 'テーマを切り替え', key: '', run: toggleTheme },
  ]
  const parsed = createMemo(() => parseQuery(query()))
  const filters = () => chips().map((c) => c.filter)
  const terms = () => (state() === 'command' ? parsed().terms : markTerms(parsed()))
  const RECENT = 8
  // 項目は、終わり近くまでスクロールするたびに PAGE 件ずつ足して出す
  const PAGE = 30
  const [shown, setShown] = createSignal(PAGE)
  createEffect(() => {
    void [state(), query(), chips()]
    setShown(PAGE)
  })
  const found = createMemo(() =>
    state() === 'search' && (query().trim() || chips().length)
      ? findItems(lib(), parsed(), filters(), props.recent)
      : [],
  )
  const more = () => {
    if (shown() < found().length) setShown(shown() + PAGE)
  }
  const rows = createMemo<Row[]>(() => {
    if (state() === 'command')
      return commands()
        .map((c) => ({ c, sc: commandScore(c.label, query()) }))
        .filter((x) => x.sc > 0)
        .toSorted((a, b) => b.sc - a.sc)
        .map((x) => x.c)
    if (state() !== 'search') return []
    const q = parsed()
    const fs = filters()
    if (!query().trim() && !fs.length)
      return recentItems(lib(), props.recent ?? [])
        .slice(0, RECENT)
        .map((it) => ({ type: 'recent', it }))
    const out: Row[] = []
    if (q.typing) out.push(...candidates(lib(), q.typing, fs).map((c): Row => ({ type: 'filter', c })))
    else if (!fs.length && !q.loose.length && q.terms.length) {
      const has = (s: string) => q.terms.every((t) => fold(s).includes(t))
      out.push(
        ...commands()
          .filter((c) => has(c.label))
          .slice(0, 3),
      )
      for (const p of lib()
        .projects.filter((x) => has(x.name))
        .slice(0, 3))
        out.push({ type: 'proj', p })
    }
    const items = found()
    for (const f of items.slice(0, shown())) out.push({ type: 'item', ...f })
    if (!fs.length && !q.loose.length && query().trim() && shown() >= items.length)
      out.push({ type: 'create', q: query().trim() })
    return out
  })
  /** 打っている途中の語を、絞り込みにする */
  const commit = (c: Candidate) => {
    setChips([...chips(), chipOf(c)])
    const at = parsed().typing?.at
    setQuery(at === undefined ? query() : query().slice(0, at))
    setIdx(0)
  }
  const openPage = (c: Candidate) => {
    const f = c.filter
    if (f.kind === 'ext' || f.kind === 'not') return commit(c)
    close()
    if (f.kind === 'tag') props.onOpenTag?.(f.tag)
    else if (f.place.group) props.onOpenGroup?.(f.place.group)
    else if (f.place.project) props.onOpenProject?.(f.place.project)
  }
  const hints = (): Hint[] | undefined => {
    if (state() !== 'search') return undefined
    const typing = parsed().typing
    if (typing)
      return [
        ['Enter / Tab', typing.kind === 'not' ? '除外' : '絞り込み'],
        ...(typing.kind === 'tag' || typing.kind === 'place' ? [['Ctrl Enter', 'ページを開く'] satisfies Hint] : []),
        ['Esc', '閉じる'],
      ]
    if (chips().length)
      return [
        ['Enter', '開く'],
        ['Backspace', '絞り込みを解除'],
        ['Esc', '閉じる'],
      ]
    if (query().trim()) return undefined
    return [
      ['#', 'タグ'],
      ['@', '場所'],
      ['.', '種類'],
      ['-', '除外'],
      ['>', '操作'],
      ...(aiOn.latest ? [['?', 'AI で検索'] satisfies Hint] : []),
      ['Esc', '閉じる'],
    ]
  }
  // 先頭の「>」で操作の検索に、「?」で AI での検索に入る。日本語入力の全角の記号も同じに扱う
  const onQueryInput = (q: string, composing: boolean) => {
    setIdx(0)
    const head = composing || state() !== 'search' || chips().length ? undefined : fold(q.trimStart())[0]
    const to = head === '>' ? 'command' : head === '?' && aiOn.latest ? 'prompt' : undefined
    if (to) setState(to)
    setQuery(to ? q.trimStart().slice(1) : q)
  }

  // AI 検索が有効でなければ、Tab で内容での検索に入れない
  const [aiOn] = createResource(
    () => (searching() && props.contentSearch && props.autoTag) || undefined,
    async (a) => {
      const s = await a.get()
      return s.enabled && s.installed && s.search
    },
  )
  const [prepared, setPrepared] = createSignal<'preparing' | 'ready' | { error: string }>()
  // 入るたびに起動を確かめる。止まっていれば、起動し終えるまで「モデルを起動しています」と出す
  createEffect(() => {
    if (state() !== 'prompt' || !props.contentSearch) {
      setPrepared(undefined)
      return
    }
    let live = true
    onCleanup(() => (live = false))
    setPrepared('preparing')
    props.contentSearch.prepare().then(
      () => live && setPrepared('ready'),
      (e: unknown) => live && setPrepared({ error: e instanceof Error ? e.message : String(e) }),
    )
  })
  const [settled, setSettled] = createSignal('')
  createEffect(() => {
    const q = state() === 'prompt' ? query().trim() : ''
    const t = window.setTimeout(() => setSettled(q), 250)
    onCleanup(() => clearTimeout(t))
  })
  const [hits] = createResource(
    () => (state() === 'prompt' && prepared() === 'ready' && settled()) || undefined,
    async (q) => (await props.contentSearch?.search(q).catch(() => undefined)) ?? [],
  )
  const hitRows = createMemo<Row[]>(() => {
    if (state() !== 'prompt' || !settled()) return []
    return (hits.latest ?? []).flatMap((h) => {
      const it = lib().byId.get(h.id)
      if (!it) return []
      return [{ type: 'hit' as const, it, at: h.at }]
    })
  })
  const shownRows = () => (state() === 'prompt' ? hitRows() : rows())
  const promptResults = () => {
    const p = prepared()
    if (p === 'preparing')
      return (
        <div class={styles.preparing}>
          <Spinner size={16} />
          モデルを起動しています…
        </div>
      )
    if (typeof p === 'object') return <ResultHeading>{p.error}</ResultHeading>
    if (!settled()) return undefined
    return <SearchResults lib={lib()} rows={hitRows()} selected={idx()} terms={[]} onRun={run} />
  }

  const run = (r: Row | undefined) => {
    if (!r) return
    if (r.type === 'filter') return commit(r.c)
    close()
    if (r.type === 'cmd') r.run()
    else if (r.type === 'proj') props.onOpenProject?.(r.p.name)
    else if (r.type === 'item' || r.type === 'recent') props.onOpenItem?.(r.it.id)
    else if (r.type === 'hit') props.onOpenItem?.(r.it.id, r.at)
    else props.onCreate?.(r.q)
  }

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault()
      setState('search')
    }
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  let menuEl!: HTMLDivElement
  const away = (e: PointerEvent) => {
    if (e.target instanceof Node && !menuEl.contains(e.target)) close()
  }
  createEffect(() => {
    if (!menuOpen()) return
    document.addEventListener('pointerdown', away)
    onCleanup(() => document.removeEventListener('pointerdown', away))
  })

  // 開くたびに読み直す（コマンドを入れたあとなど）
  const [plugins, { refetch: reloadPlugins }] = createResource(
    () => state() === 'plugins' || undefined,
    () => (props.loadPlugins ?? (async () => builtinReport()))(),
  )
  const [known, { refetch: reloadKnown }] = createResource(
    () => (state() === 'libraries' && props.libraries) || undefined,
    (l) => l.list(),
  )
  const [usage, { refetch: reloadUsage }] = createResource(
    () => (state() === 'settings' && props.tidy) || undefined,
    (t) => t.usage(),
  )
  const [unused, { refetch: reloadUnused }] = createResource(
    () => (state() === 'settings' && props.tidy) || undefined,
    (t) => t.unusedPlugins(),
  )
  const [dev, { mutate: setDev }] = createResource(
    () => (state() === 'settings' && props.developer) || undefined,
    (d) => d.get(),
  )
  const [app, { refetch: reloadApp }] = createResource(
    () => ((state() === 'settings' || state() === 'plugins') && props.appSettings) || undefined,
    (a) => a.get(),
  )
  const [startup, { refetch: reloadStartup }] = createResource(
    () => (state() === 'settings' && props.startup) || undefined,
    (s) => s.get(),
  )
  const [autoTag, { refetch: reloadAutoTag }] = createResource(
    () => (state() === 'settings' && props.autoTag) || undefined,
    (a) => a.get(),
  )
  const [remote, { refetch: reloadRemote }] = createResource(
    () => (state() === 'settings' && props.remote) || undefined,
    (r) => r.status(),
  )
  createEffect(() => {
    const r = props.remote
    if (r) onCleanup(r.onAskClosed(() => state() === 'settings' && void reloadRemote()))
  })
  const [autoTagProgress, setAutoTagProgress] = createSignal<AutoTagProgress>()
  createEffect(() => {
    const a = props.autoTag
    if (a) onCleanup(a.onProgress(setAutoTagProgress))
  })

  const menuItems = (): NavMenuEntry[] => [
    ...(props.onChooseLibrary
      ? [
          {
            id: 'library',
            icon: 'library' as const,
            label: 'ライブラリを切り替え',
            hint: props.library?.split(/[\\/]/).at(-1) ?? '未選択',
            title: props.library,
          },
        ]
      : []),
    ...(props.onNewWindow ? [{ id: 'window', icon: 'external' as const, label: '新しいウィンドウ' }] : []),
    { id: 'plugins', icon: 'plugin', label: 'プラグイン' },
    'separator',
    { id: 'theme', icon: 'theme', label: 'テーマを切り替え' },
    { id: 'keys', icon: 'keyboard', label: 'ショートカット一覧' },
    { id: 'settings', icon: 'settings', label: '設定' },
  ]
  const onMenu = (id: string) => {
    if (id === 'settings') return openSettings()
    if (id === 'theme') return toggleTheme()
    if (id === 'keys') return setState('help')
    if (id === 'plugins') return setState('plugins')
    if (id === 'library' && props.libraries) return setState('libraries')
    if (id === 'library') {
      close()
      return props.onChooseLibrary?.()
    }
    close()
    if (id === 'window') props.onNewWindow?.()
  }

  return (
    <>
      <TitleBar
        end={
          <span class={styles.end}>
            <ActivityButton activities={props.activities ?? []} />
            <button
              type="button"
              class={styles.ib}
              aria-label="新しいノートを作成"
              data-tip="新しいノートを作成（Ctrl N）"
              onClick={() => props.onCreate?.()}
            >
              <Icon name="newNote" />
            </button>
            <button
              type="button"
              class={styles.ib}
              aria-label="検索"
              data-tip="検索（Ctrl P）"
              aria-expanded={searching()}
              onClick={() => (searching() ? close() : setState('search'))}
            >
              <Icon name="search" />
            </button>
          </span>
        }
      >
        <div class={styles.menuAt} ref={menuEl}>
          <button
            type="button"
            class={styles.ib}
            aria-label="メニュー"
            data-tip="メニュー"
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            onClick={() => (menuOpen() ? close() : setState('menu'))}
          >
            <img class={styles.appIcon} src={appIcon} alt="" />
          </button>
          <Show when={menuOpen()}>
            <div class={styles.menu}>
              <NavMenu focusFirst={init === 'closed'} items={menuItems()} onSelect={onMenu} onClose={close} />
            </div>
          </Show>
        </div>
        <Show when={props.tabs}>{(t) => <TabStrip {...t()} />}</Show>
      </TitleBar>
      <Show when={searching()}>
        <SearchPalette
          mode={state() === 'prompt' ? 'prompt' : state() === 'command' ? 'command' : 'search'}
          chips={chips().map((c) => c.label)}
          onRemoveChip={(i) => {
            setChips(chips().filter((_, j) => j !== i))
            setIdx(0)
          }}
          hints={hints()}
          query={query()}
          results={
            state() === 'prompt' ? (
              promptResults()
            ) : rows().length || query().trim() || chips().length ? (
              <SearchResults lib={lib()} rows={rows()} selected={idx()} terms={terms()} onRun={run} />
            ) : undefined
          }
          onClose={close}
          onMore={more}
          onQueryInput={onQueryInput}
          onInputKeyDown={(e) => {
            if (e.isComposing) return
            const sel = shownRows()[idx()]
            if (e.key === 'Escape') close()
            else if (e.key === 'Backspace' && !query()) {
              if (state() === 'search' && chips().length) setChips(chips().slice(0, -1))
              else if (state() !== 'search') setState('search')
              else return
              e.preventDefault()
              setIdx(0)
            } else if (e.key === 'Tab') {
              const c = sel?.type === 'filter' ? sel : rows().find((r) => r.type === 'filter')
              if (state() !== 'search' || !parsed().typing || c?.type !== 'filter') return
              e.preventDefault()
              commit(c.c)
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = shownRows().length
              setIdx(Math.max(0, Math.min(n - 1, idx() + (e.key === 'ArrowDown' ? 1 : -1))))
              if (idx() >= n - 5) more()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (state() === 'search' && (e.ctrlKey || e.metaKey)) {
                if (sel?.type === 'filter') return openPage(sel.c)
                const q = query().trim()
                close()
                props.onCreate?.(q || undefined)
              } else run(sel)
            }
          }}
        />
      </Show>
      <Show when={state() === 'help'}>
        <HelpDialog onClose={close} />
      </Show>
      <Show when={state() === 'plugins'}>
        <PluginsDialog
          report={plugins.latest}
          pick={pick()}
          actions={props.pluginActions}
          onChanged={
            props.onPluginsChanged &&
            (async (quiet) => {
              await props.onPluginsChanged!(quiet)
              await reloadPlugins()
            })
          }
          onRefresh={reloadPlugins}
          commandPaths={app.latest?.commandPaths}
          onPickCommand={props.appSettings && ((name) => props.appSettings!.pickCommand(name))}
          onCommandPathChange={
            props.appSettings &&
            (async (name, path) => {
              const a = app.latest ?? (await props.appSettings!.get())
              const { [name]: _, ...rest } = a.commandPaths
              await props.appSettings!.set({ ...a, commandPaths: path ? { ...rest, [name]: path } : rest })
              await reloadApp()
            })
          }
          onClose={close}
        />
      </Show>
      <Show when={state() === 'libraries'}>
        <LibrariesDialog
          libraries={known.latest}
          onOpen={
            props.libraries &&
            (async (path) => {
              await props.libraries!.switch(path)
              props.onReopen?.()
            })
          }
          onForget={
            props.libraries &&
            (async (path) => {
              await props.libraries!.forget(path)
              await reloadKnown()
            })
          }
          onChoose={props.onChooseLibrary && (async () => props.onChooseLibrary!())}
          onClose={close}
        />
      </Show>
      <Show when={state() === 'settings'}>
        <SettingsDialog
          page={settingsPage()}
          version={version}
          prefs={prefs()}
          onPrefsChange={setPrefs}
          screens={props.screens?.map((s) => ({ value: s.place, label: s.label }))}
          schemes={schemes()}
          onSchemesChange={setSchemes}
          onExportFile={props.exportFile}
          library={props.library}
          onOpenLibraries={
            props.libraries ? () => setState('libraries') : props.onChooseLibrary && (() => void onMenu('library'))
          }
          app={app.latest}
          onAppChange={
            props.appSettings &&
            (async (next) => {
              const before = app.latest
              await props.appSettings!.set(next)
              await reloadApp()
              if (before && before.thumbSize !== next.thumbSize) props.onReopen?.()
            })
          }
          startup={startup.latest}
          onStartupChange={
            props.startup &&
            (async (on) => {
              await props.startup!.set(on)
              await reloadStartup()
            })
          }
          loadNotices={async () => (await import('../notices/third-party.json')).default}
          usage={usage.latest}
          unused={unused.latest}
          onClear={
            props.tidy &&
            (async (kind) => {
              await props.tidy!.clear(kind)
              props.onReopen?.()
            })
          }
          onRemoveUnused={
            props.tidy &&
            (async () => {
              await props.tidy!.removeUnusedPlugins()
              await Promise.all([reloadUnused(), reloadUsage()])
            })
          }
          autoTag={autoTag.latest}
          autoTagProgress={autoTagProgress()}
          onAutoTagChange={
            props.autoTag &&
            (async (on) => {
              try {
                await props.autoTag!.set(on)
              } finally {
                setAutoTagProgress(undefined)
                await reloadAutoTag()
              }
            })
          }
          onCancelDownload={props.autoTag && (() => props.autoTag!.cancelDownload())}
          onSuggestChange={
            props.autoTag &&
            (async (mode) => {
              await props.autoTag!.setSuggest(mode)
              await reloadAutoTag()
            })
          }
          onSearchChange={
            props.autoTag &&
            (async (on) => {
              await props.autoTag!.setSearch(on)
              await reloadAutoTag()
            })
          }
          developer={dev.latest}
          onDeveloperChange={
            props.developer &&
            (async (d) => {
              await props.developer!.set(d)
              setDev(d)
              await props.onPluginsChanged?.()
            })
          }
          onPickDevPath={props.developer && ((kind) => props.developer!.pick(kind))}
          onReload={props.onPluginsChanged && (() => void props.onPluginsChanged!())}
          remote={remote.latest}
          remoteActions={props.remote}
          onRemoteChanged={async () => void (await reloadRemote())}
          onClose={close}
        />
      </Show>
    </>
  )
}
