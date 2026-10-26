import { Show, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { version } from '../../package.json'
import type { LibraryActions, TidyActions } from '../backend/types'
import { HelpDialog } from '../components/overlay/HelpDialog/HelpDialog'
import { LibrariesDialog } from '../components/overlay/LibrariesDialog/LibrariesDialog'
import { type Notices, NoticesDialog } from '../components/overlay/NoticesDialog/NoticesDialog'
import { OtherDialog } from '../components/overlay/OtherDialog/OtherDialog'
import { PluginsDialog } from '../components/overlay/PluginsDialog/PluginsDialog'
import { NavMenu, type NavMenuEntry } from '../components/search/NavMenu/NavMenu'
import { SearchDock } from '../components/search/SearchDock/SearchDock'
import type { Library } from '../model/library'
import { builtinReport } from '../plugins/builtin'
import type { PluginActions, PluginReport } from '../plugins/types'
import { findItems, searchTerms } from '../model/search'
import styles from './AppDock.module.css'
import { type Row, SearchResults } from '../components/search/SearchResults/SearchResults'

/** 行き先。 */
export type Place = 'home' | 'tags' | 'projects' | 'tidy'
/**
 * closed 閉じている / menu ☰ を開いた / settings その先の設定 / search 検索に入力中 / prompt プロンプト / help キー操作の一覧 /
 * plugins プラグイン / notices 権利表示 / libraries ライブラリの切り替え / other その他
 */
export type DockState =
  | 'closed'
  | 'menu'
  | 'settings'
  | 'search'
  | 'prompt'
  | 'help'
  | 'plugins'
  | 'notices'
  | 'libraries'
  | 'other'

export interface AppDockProps {
  lib: Library
  /** いまいる所。メニューで印を付ける。 */
  here?: Place
  initial?: DockState
  /** 検索欄に最初から入っている語。 */
  query?: string
  /** ふだんは出さず、Ctrl P で検索を開いたときだけ出す（ノートや素材を見ているとき）。 */
  hidden?: boolean
  /** 保存先に書き込めない。＋ を止め、上に知らせを出す。 */
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

/** どの画面でも下に浮かべる検索バー。☰ のメニュー、検索の結果、キー操作の一覧をまとめて受け持つ。 */
export function AppDock(props: AppDockProps) {
  const init = props.initial ?? 'closed'
  const [state, setState] = createSignal<DockState>(init)
  const [query, setQuery] = createSignal(props.query ?? '')
  const [idx, setIdx] = createSignal(0)
  const lib = () => props.lib
  const open = () => state() === 'search' || state() === 'prompt'
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
  // 一覧は大きいので、初めて開いたときに読む
  const [notices] = createResource(
    () => state() === 'notices' || undefined,
    async () => (await import('../notices/third-party.json')).default as Notices,
  )

  const results = () => <SearchResults lib={lib()} rows={rows()} selected={idx()} terms={terms()} onRun={run} />

  const menuItems = (): NavMenuEntry[] =>
    state() === 'settings'
      ? [
          { id: 'back', icon: '‹', label: '設定', heading: true },
          'separator',
          ...(props.onChooseLibrary
            ? [
                {
                  id: 'library',
                  icon: '▤',
                  label: 'ライブラリを切り替え',
                  hint: props.library?.split(/[\\/]/).at(-1) ?? '未選択',
                  title: props.library,
                },
              ]
            : []),
          { id: 'theme', icon: '◐', label: 'テーマを切り替え' },
          { id: 'keys', icon: '⌨', label: 'ショートカット一覧', kbd: '?' },
          { id: 'plugins', icon: '⧉', label: 'プラグイン' },
          { id: 'other', icon: '⋯', label: 'その他' },
          { id: 'notices', icon: '©', label: '権利表示' },
        ]
      : [
          { id: 'home', icon: '⌂', label: 'ホーム', current: props.here === 'home' },
          { id: 'tags', icon: '#', label: 'タグ', count: lib().tagGroups().size, current: props.here === 'tags' },
          {
            id: 'projects',
            icon: '▦',
            label: 'プロジェクト',
            count: lib().projects.length,
            current: props.here === 'projects',
          },
          'separator',
          { id: 'settings', icon: '⚙', label: '設定' },
        ]
  const onMenu = (id: string) => {
    if (id === 'settings') return setState('settings')
    if (id === 'back') return setState('menu')
    if (id === 'theme') return toggleTheme()
    if (id === 'keys') return setState('help')
    if (id === 'plugins') return setState('plugins')
    if (id === 'notices') return setState('notices')
    if (id === 'other') return setState('other')
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
      <Show when={props.readOnly && !open()}>
        <div class={styles.ro} role="status">
          <b>読み取り専用</b>
          <span title="保存先に書き込めないため、読み取り専用になっています">ⓘ</span>
          <button type="button">編集を有効にする</button>
        </div>
      </Show>
      <Show when={!props.hidden || open()}>
        <SearchDock
          open={open()}
          mode={state() === 'prompt' ? 'prompt' : 'search'}
          query={query()}
          results={state() === 'search' ? results() : undefined}
          menuOpen={state() === 'menu' || state() === 'settings'}
          menu={<NavMenu focusFirst={init === 'closed'} items={menuItems()} onSelect={onMenu} onClose={close} />}
          readOnly={props.readOnly}
          onOpen={() => setState('search')}
          onClose={close}
          onQueryInput={(q) => {
            setQuery(q)
            setIdx(0)
          }}
          onMenuToggle={() => setState(state() === 'closed' ? 'menu' : 'closed')}
          onCreate={() => {
            const q = query().trim()
            close()
            props.onCreate?.(q || undefined)
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
