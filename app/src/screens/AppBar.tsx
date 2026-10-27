import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { version } from '../../package.json'
import appIcon from '../../src-tauri/icons/32x32.png'
import type { DeveloperActions, LibraryActions, TidyActions } from '../backend/types'
import { Icon } from '../components/base/Icon/Icon'
import { TitleBar } from '../components/nav/TitleBar/TitleBar'
import { HelpDialog } from '../components/dialog/HelpDialog/HelpDialog'
import { LibrariesDialog } from '../components/dialog/LibrariesDialog/LibrariesDialog'
import { type Notices, NoticesDialog } from '../components/dialog/NoticesDialog/NoticesDialog'
import { OtherDialog } from '../components/dialog/OtherDialog/OtherDialog'
import { DeveloperDialog } from '../components/dialog/DeveloperDialog/DeveloperDialog'
import { PluginsDialog } from '../components/dialog/PluginsDialog/PluginsDialog'
import { NavMenu, type NavMenuEntry } from '../components/nav/NavMenu/NavMenu'
import { SearchPalette } from '../components/nav/SearchPalette/SearchPalette'
import type { Library } from '../model/library'
import { builtinReport } from '../plugins/builtin'
import type { PluginActions, PluginReport } from '../plugins/types'
import { findItems, searchTerms } from '../model/search'
import styles from './AppBar.module.css'
import { type Row, SearchResults } from '../components/nav/SearchResults/SearchResults'

/** 行き先。 */
export type Place = 'home' | 'tags' | 'projects' | 'tidy'
/**
 * closed 閉じている / menu メニューを開いた / settings その先の設定 / places いまの場所から開いた画面の一覧 /
 * search 検索に入力中 / prompt プロンプト /
 * help キー操作の一覧 / plugins プラグイン / notices 権利表示 / libraries ライブラリの切り替え / other その他
 */
export type BarState =
  | 'closed'
  | 'menu'
  | 'settings'
  | 'places'
  | 'search'
  | 'prompt'
  | 'help'
  | 'plugins'
  | 'notices'
  | 'libraries'
  | 'other'
  | 'developer'

export interface AppBarProps {
  lib: Library
  /** いまいる所。メニューで印を付ける。 */
  here?: Place
  /** いまの場所までの道のり。最後がいまの画面。 */
  crumbs?: string[]
  /** 渡すと、メニューの右に戻るを出す。 */
  onBack?: () => void
  /** いまより前の場所を押したとき。i は crumbs の位置。 */
  onCrumb?: (i: number) => void
  initial?: BarState
  /** 検索欄に最初から入っている語。 */
  query?: string
  /** 保存先に書き込めない。タイトルバーに知らせを出す。 */
  readOnly?: boolean
  onGo?: (to: Place) => void
  onOpenProject?: (name: string) => void
  onOpenItem?: (id: string) => void
  /** 新しいノート。名前を入れていればその名前で。 */
  onCreate?: (name?: string) => void
  /** 開いているライブラリの場所。設定に出す。 */
  library?: string
  /** 渡すと、設定にライブラリを選ぶ項目を出す。 */
  onChooseLibrary?: () => void | Promise<void>
  /** 開いたことのあるライブラリ。渡すと、ライブラリを選ぶ項目で履歴の窓を開く。 */
  libraries?: LibraryActions
  /** キャッシュと使っていないプラグインの片付け。渡すと「その他」に出す。 */
  tidy?: TidyActions
  /** 開発者モードの設定。渡すと、設定に「開発者モード」を出す。 */
  developer?: DeveloperActions
  /** 開くライブラリを替えたときや、キャッシュを消したとき。ライブラリを開き直す。 */
  onReopen?: () => void
  /** プラグインの一覧を読む。省略すると組み込みのものだけを出す。 */
  loadPlugins?: () => Promise<PluginReport>
  /** プラグインを入れる・外すなどの操作。 */
  pluginActions?: PluginActions
  /** 使うプラグインが変わったとき。ライブラリを開き直す。 */
  onPluginsChanged?: () => void
}

const toggleTheme = () => {
  const d = document.documentElement.dataset
  d.theme = d.theme === 'light' ? 'dark' : 'light'
}

/** 画面の上のタイトルバー。アプリのアイコン（メニュー）・戻る・いまの場所を置き、メニューと Ctrl P の検索、設定の窓を受け持つ。 */
export function AppBar(props: AppBarProps) {
  const init = props.initial ?? 'closed'
  const [state, setState] = createSignal<BarState>(init)
  const [query, setQuery] = createSignal(props.query ?? '')
  const [idx, setIdx] = createSignal(0)
  const lib = () => props.lib
  const searching = () => state() === 'search' || state() === 'prompt'
  const menuOpen = () => state() === 'menu' || state() === 'settings'
  const placesOpen = () => state() === 'places'
  const close = () => {
    setState('closed')
    setQuery('')
    setIdx(0)
  }
  const commands = (): Row[] => [
    { type: 'cmd', label: '整理を開く', key: 'Ctrl U', run: () => props.onGo?.('tidy') },
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

  // メニューは外を押すと閉じる
  let menuEl!: HTMLDivElement
  let placesEl: HTMLSpanElement | undefined
  const away = (e: PointerEvent) => {
    const at = placesOpen() ? placesEl : menuEl
    if (e.target instanceof Node && !at?.contains(e.target)) close()
  }
  createEffect(() => {
    if (!menuOpen() && !placesOpen()) return
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
    () => (state() === 'other' && props.tidy) || undefined,
    (t) => t.usage(),
  )
  const [unused, { refetch: reloadUnused }] = createResource(
    () => (state() === 'other' && props.tidy) || undefined,
    (t) => t.unusedPlugins(),
  )
  const [dev] = createResource(
    () => (state() === 'developer' && props.developer) || undefined,
    (d) => d.get(),
  )
  // 一覧は大きいので、初めて開いたときに読む
  const [notices] = createResource(
    () => state() === 'notices' || undefined,
    async () => (await import('../notices/third-party.json')).default as Notices,
  )

  const placeItems = (): NavMenuEntry[] => [
    { id: 'home', icon: 'home', label: 'ホーム', current: props.here === 'home' },
    {
      id: 'projects',
      icon: 'folder',
      label: 'プロジェクト',
      count: lib().projects.length,
      current: props.here === 'projects',
    },
    { id: 'tags', icon: 'hash', label: 'タグ', count: lib().tagGroups().size, current: props.here === 'tags' },
  ]
  const menuItems = (): NavMenuEntry[] =>
    state() === 'settings'
      ? [
          { id: 'back', icon: 'back', label: '設定', heading: true },
          'separator',
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
          { id: 'theme', icon: 'theme', label: 'テーマを切り替え' },
          { id: 'keys', icon: 'keyboard', label: 'ショートカット一覧', kbd: '?' },
          { id: 'plugins', icon: 'plugin', label: 'プラグイン' },
          ...(props.developer ? [{ id: 'developer', icon: 'code' as const, label: '開発者モード' }] : []),
          { id: 'other', icon: 'more', label: 'その他' },
          { id: 'notices', icon: 'notices', label: '権利表示' },
        ]
      : [
          { id: 'search', icon: 'search', label: '検索', kbd: 'Ctrl P' },
          { id: 'settings', icon: 'settings', label: '設定' },
        ]
  const onMenu = (id: string) => {
    if (id === 'settings') return setState('settings')
    if (id === 'back') return setState('menu')
    if (id === 'search') return setState('search')
    if (id === 'theme') return toggleTheme()
    if (id === 'keys') return setState('help')
    if (id === 'plugins') return setState('plugins')
    if (id === 'notices') return setState('notices')
    if (id === 'other') return setState('other')
    if (id === 'developer') return setState('developer')
    if (id === 'library' && props.libraries) return setState('libraries')
    if (id === 'library') {
      close()
      return props.onChooseLibrary?.()
    }
    setState('closed')
    if (id === 'home' || id === 'tags' || id === 'projects') props.onGo?.(id)
  }

  return (
    <>
      <TitleBar
        end={
          <Show when={props.readOnly}>
            <span class={styles.ro} role="status" title="保存先に書き込めないため、読み取り専用になっています">
              <b>読み取り専用</b>
              <button type="button">編集を有効にする</button>
            </span>
          </Show>
        }
      >
        <div class={styles.menuAt} ref={menuEl}>
          <button
            type="button"
            class={styles.ib}
            aria-label="メニュー"
            title="メニュー"
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
            title="戻る（Esc）"
            onClick={() => props.onBack?.()}
          >
            <Icon name="back" />
          </button>
        </Show>
        <nav class={styles.crumbs} aria-label="いまの場所">
          <For each={props.crumbs ?? []}>
            {(c, i) => (
              <>
                <Show when={i() > 0}>
                  <span class={styles.sep} aria-hidden="true">
                    /
                  </span>
                </Show>
                <Show
                  when={i() === (props.crumbs?.length ?? 0) - 1}
                  fallback={
                    <button type="button" class={styles.crumb} onClick={() => props.onCrumb?.(i())}>
                      {c}
                    </button>
                  }
                >
                  <span class={styles.placesAt} ref={placesEl}>
                    <button
                      type="button"
                      class={styles.crumb}
                      aria-current="page"
                      aria-haspopup="menu"
                      aria-expanded={placesOpen()}
                      onClick={() => (placesOpen() ? close() : setState('places'))}
                    >
                      {c}
                    </button>
                    <Show when={placesOpen()}>
                      <div class={styles.menu}>
                        <NavMenu focusFirst items={placeItems()} onSelect={onMenu} onClose={close} />
                      </div>
                    </Show>
                  </span>
                </Show>
              </>
            )}
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
          actions={props.pluginActions}
          onChanged={props.onPluginsChanged}
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
      <Show when={state() === 'developer'}>
        <DeveloperDialog
          developer={dev.latest}
          onChange={
            props.developer &&
            (async (d) => {
              await props.developer!.set(d)
              props.onPluginsChanged?.()
            })
          }
          onPickDir={props.developer && (() => props.developer!.pickDir())}
          onReload={props.onPluginsChanged}
          onClose={close}
        />
      </Show>
      <Show when={state() === 'other'}>
        <OtherDialog
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
          onClose={close}
        />
      </Show>
    </>
  )
}
