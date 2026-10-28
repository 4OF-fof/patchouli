import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { version } from '../../package.json'
import appIcon from '../../src-tauri/icons/32x32.png'
import type { DeveloperActions, LibraryActions, TidyActions } from '../backend/types'
import { Icon } from '../components/base/Icon/Icon'
import { TitleBar } from '../components/nav/TitleBar/TitleBar'
import { HelpDialog } from '../components/dialog/HelpDialog/HelpDialog'
import { LibrariesDialog } from '../components/dialog/LibrariesDialog/LibrariesDialog'
import { type Notices, NoticesDialog } from '../components/dialog/NoticesDialog/NoticesDialog'
import { PluginsDialog } from '../components/dialog/PluginsDialog/PluginsDialog'
import { SettingsDialog } from '../components/dialog/SettingsDialog/SettingsDialog'
import { type Activity, ActivityButton } from '../components/nav/ActivityButton/ActivityButton'
import { NavMenu, type NavMenuEntry } from '../components/nav/NavMenu/NavMenu'
import { SearchPalette } from '../components/nav/SearchPalette/SearchPalette'
import type { Library } from '../model/library'
import { builtinReport } from '../plugins/builtin'
import type { PluginActions, PluginReport } from '../plugins/types'
import { findItems, searchTerms } from '../model/search'
import styles from './AppBar.module.css'
import { type Row, SearchResults } from '../components/nav/SearchResults/SearchResults'

export type Place = 'home' | 'all' | 'tags' | 'projects' | 'tidy'
export type BarState =
  | 'closed'
  | 'menu'
  | 'search'
  | 'prompt'
  | 'help'
  | 'plugins'
  | 'notices'
  | 'libraries'
  | 'settings'

export interface BarRequest {
  state: BarState
  plugin?: { id: string; dev: boolean }
}

export interface AppBarProps {
  lib: Library
  here?: Place
  crumbs?: string[]
  onBack?: () => void
  onCrumb?: (i: number) => void
  siblingsOf?: (i: number) => NavMenuEntry[] | undefined
  onSibling?: (i: number, id: string) => void
  crumbMenu?: number
  initial?: BarState
  query?: string
  readOnly?: boolean
  activities?: Activity[]
  onGo?: (to: Place) => void
  onOpenProject?: (name: string) => void
  onOpenItem?: (id: string) => void
  onCreate?: (name?: string) => void
  library?: string
  onChooseLibrary?: () => void | Promise<void>
  libraries?: LibraryActions
  tidy?: TidyActions
  developer?: DeveloperActions
  onReopen?: () => void
  loadPlugins?: () => Promise<PluginReport>
  pluginActions?: PluginActions
  onPluginsChanged?: () => void | Promise<void>
  request?: BarRequest
}

const toggleTheme = () => {
  const d = document.documentElement.dataset
  d.theme = d.theme === 'light' ? 'dark' : 'light'
}

export function AppBar(props: AppBarProps) {
  const init = props.initial ?? 'closed'
  const [state, setState] = createSignal<BarState>(init)
  const [query, setQuery] = createSignal(props.query ?? '')
  const [idx, setIdx] = createSignal(0)
  const [pick, setPick] = createSignal<BarRequest['plugin']>()
  createEffect(() => {
    const r = props.request
    if (!r) return
    setPick(r.plugin)
    setState(r.state)
  })
  const lib = () => props.lib
  const searching = () => state() === 'search' || state() === 'prompt'
  const menuOpen = () => state() === 'menu'
  const close = () => {
    setState('closed')
    setQuery('')
    setIdx(0)
    setPick(undefined)
  }
  const commands = (): Row[] => [
    { type: 'cmd', label: '整理を開く', key: 'Ctrl U', run: () => props.onGo?.('tidy') },
    { type: 'cmd', label: 'すべての項目', key: '', run: () => props.onGo?.('all') },
    { type: 'cmd', label: 'プロジェクト一覧', key: '', run: () => props.onGo?.('projects') },
    { type: 'cmd', label: 'タグ一覧', key: '', run: () => props.onGo?.('tags') },
    { type: 'cmd', label: '新しいノートを作成', key: 'Ctrl N', run: () => props.onCreate?.() },
    { type: 'cmd', label: 'ホームに戻る', key: '', run: () => props.onGo?.('home') },
    { type: 'cmd', label: 'ショートカット一覧', key: '?', run: () => setState('help') },
    { type: 'cmd', label: 'テーマを切り替え', key: '', run: toggleTheme },
  ]
  const terms = () => searchTerms(query())
  const rows = createMemo<Row[]>(() => {
    if (state() !== 'search') return []
    const ts = terms()
    const has = (s: string) => ts.every((t) => s.toLowerCase().includes(t))
    const out: Row[] = []
    if (ts.length)
      out.push(
        ...commands()
          .filter((c) => c.type === 'cmd' && has(c.label))
          .slice(0, 3),
      )
    for (const p of lib()
      .projects.filter((x) => !ts.length || has(x.name))
      .slice(0, ts.length ? 3 : 2))
      out.push({ type: 'proj', p })
    if (!ts.length) {
      for (const it of lib()
        .items.toSorted((a, b) => a.moved - b.moved)
        .slice(0, 7))
        out.push({ type: 'item', it, where: `最近 · ${it.folder ?? 'プロジェクトなし'}` })
    } else for (const f of findItems(lib(), ts).slice(0, 8)) out.push({ type: 'item', ...f })
    if (query().trim()) out.push({ type: 'create', q: query().trim() })
    return out
  })

  const run = (r: Row | undefined) => {
    if (!r) return
    close()
    if (r.type === 'cmd') r.run()
    else if (r.type === 'proj') props.onOpenProject?.(r.p.name)
    else if (r.type === 'item') props.onOpenItem?.(r.it.id)
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
  // 一覧は大きいので、初めて開いたときに読む
  const [notices] = createResource(
    () => state() === 'notices' || undefined,
    async () => (await import('../notices/third-party.json')).default as Notices,
  )

  const placeItems = (): NavMenuEntry[] => [
    { id: 'home', icon: 'home', label: 'ホーム', current: props.here === 'home' },
    { id: 'all', icon: 'grid', label: 'すべて', count: lib().items.length, current: props.here === 'all' },
    {
      id: 'projects',
      icon: 'folder',
      label: 'プロジェクト',
      count: lib().projects.length,
      current: props.here === 'projects',
    },
    { id: 'tags', icon: 'hash', label: 'タグ', count: lib().tagGroups().size, current: props.here === 'tags' },
  ]
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
    { id: 'plugins', icon: 'plugin', label: 'プラグイン' },
    'separator',
    { id: 'theme', icon: 'theme', label: 'テーマを切り替え' },
    { id: 'keys', icon: 'keyboard', label: 'ショートカット一覧', kbd: '?' },
    { id: 'notices', icon: 'notices', label: '権利表示' },
    { id: 'settings', icon: 'settings', label: '設定' },
  ]
  const [drop, setDrop] = createSignal(props.crumbMenu)
  const [clicked, setClicked] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const hover = (i: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => setDrop(i), 500)
  }
  const leave = () => {
    clearTimeout(timer)
    setDrop(undefined)
    setClicked(false)
  }
  onCleanup(() => clearTimeout(timer))
  const onMenu = (id: string) => {
    if (id === 'settings') return setState('settings')
    if (id === 'theme') return toggleTheme()
    if (id === 'keys') return setState('help')
    if (id === 'plugins') return setState('plugins')
    if (id === 'notices') return setState('notices')
    if (id === 'library' && props.libraries) return setState('libraries')
    if (id === 'library') {
      close()
      return props.onChooseLibrary?.()
    }
    close()
    if (id === 'home' || id === 'all' || id === 'tags' || id === 'projects') props.onGo?.(id)
  }

  return (
    <>
      <TitleBar
        end={
          <span class={styles.end}>
            <Show when={props.readOnly}>
              <span class={styles.ro} role="status" data-tip="保存先に書き込めないため、読み取り専用になっています">
                <b>読み取り専用</b>
                <button type="button">編集を有効にする</button>
              </span>
            </Show>
            <ActivityButton activities={props.activities ?? []} />
            <button
              type="button"
              class={styles.ib}
              aria-label="新しいノート"
              data-tip="新しいノート"
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
        <Show when={props.onBack}>
          <button
            type="button"
            class={styles.ib}
            aria-label="戻る"
            data-tip="戻る（Esc）"
            onClick={() => props.onBack?.()}
          >
            <Icon name="back" />
          </button>
        </Show>
        <nav class={styles.crumbs} aria-label="いまの場所">
          <For each={props.crumbs ?? []}>
            {(c, i) => {
              const last = () => i() === (props.crumbs?.length ?? 0) - 1
              const places = () => i() === 0 && last()
              const items = () => (drop() === i() ? (i() === 0 ? placeItems() : props.siblingsOf?.(i())) : undefined)
              return (
                <>
                  <Show when={i() > 0}>
                    <span class={styles.sep} aria-hidden="true">
                      /
                    </span>
                  </Show>
                  <span class={styles.crumbAt} onPointerEnter={() => hover(i())} onPointerLeave={leave}>
                    <button
                      type="button"
                      class={styles.crumb}
                      aria-current={last() ? 'page' : undefined}
                      aria-haspopup={places() ? 'menu' : undefined}
                      aria-expanded={places() ? drop() === 0 : undefined}
                      data-open={!!items()?.length}
                      onClick={() => {
                        if (places()) {
                          const open = drop() === 0
                          leave()
                          if (!open) {
                            setClicked(true)
                            setDrop(0)
                          }
                          return
                        }
                        if (last()) return
                        leave()
                        props.onCrumb?.(i())
                      }}
                    >
                      {c}
                    </button>
                    <Show when={items()?.length ? items() : undefined}>
                      {(list) => (
                        <div class={styles.drop}>
                          <NavMenu
                            focusFirst={clicked()}
                            items={list()}
                            onSelect={(id) => {
                              leave()
                              if (i() === 0) void onMenu(id)
                              else props.onSibling?.(i(), id)
                            }}
                            onClose={leave}
                          />
                        </div>
                      )}
                    </Show>
                  </span>
                </>
              )
            }}
          </For>
        </nav>
      </TitleBar>
      <Show when={searching()}>
        <SearchPalette
          mode={state() === 'prompt' ? 'prompt' : 'search'}
          query={query()}
          results={
            state() === 'search' ? (
              <SearchResults lib={lib()} rows={rows()} selected={idx()} terms={terms()} onRun={run} />
            ) : undefined
          }
          onClose={close}
          onQueryInput={(q) => {
            setQuery(q)
            setIdx(0)
          }}
          onInputKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'Tab') {
              e.preventDefault()
              setState(state() === 'prompt' ? 'search' : 'prompt')
              setIdx(0)
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = rows().length
              setIdx(Math.max(0, Math.min(n - 1, idx() + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter' && state() === 'search') {
              e.preventDefault()
              if (e.ctrlKey || e.metaKey) {
                const q = query().trim()
                close()
                props.onCreate?.(q || undefined)
              } else run(rows()[idx()])
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
            (async () => {
              await props.onPluginsChanged!()
              await reloadPlugins()
            })
          }
          onRefresh={() => void reloadPlugins()}
          onClose={close}
        />
      </Show>
      <Show when={state() === 'notices'}>
        <NoticesDialog notices={notices()} onClose={close} />
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
          version={version}
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
          onClose={close}
        />
      </Show>
    </>
  )
}
