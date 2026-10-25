import { For, type JSX, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { HelpDialog } from '../components/HelpDialog/HelpDialog'
import { NavMenu, type NavMenuEntry } from '../components/NavMenu/NavMenu'
import { ResultHeading, ResultRow } from '../components/ResultRow/ResultRow'
import { SearchDock } from '../components/SearchDock/SearchDock'
import { type Item, type Library, type Project, plainText, thumbOf } from '../model/library'
import styles from './AppDock.module.css'

/** 行き先。 */
export type Place = 'home' | 'tags' | 'projects' | 'tidy'
/** closed 閉じている / menu ☰ を開いた / settings その先の設定 / search 検索に入力中 / prompt プロンプト / help キー操作の一覧 */
export type DockState = 'closed' | 'menu' | 'settings' | 'search' | 'prompt' | 'help'

export interface AppDockProps {
  lib: Library
  /** いまいる所。メニューで印を付ける。 */
  here?: Place
  initial?: DockState
  /** 検索欄に最初から入っている語。 */
  query?: string
  /** 保存先に書き込めない。＋ を止め、上に知らせを出す。 */
  readOnly?: boolean
  onGo?: (to: Place) => void
  onOpenProject?: (name: string) => void
  onOpenItem?: (id: string) => void
  /** 新しいノート。名前を入れていればその名前で。 */
  onCreate?: (name?: string) => void
}

type Row =
  | { type: 'cmd'; label: string; key: string; run: () => void }
  | { type: 'proj'; p: Project }
  | { type: 'item'; it: Item; where: string }
  | { type: 'create'; q: string }

/** 見つかった語を <mark> で囲む。 */
function marked(text: string, terms: string[]): JSX.Element {
  const low = text.toLowerCase()
  const on = Array.from({ length: text.length }, () => false)
  for (const t of terms.filter(Boolean)) {
    for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) on.fill(true, i, i + t.length)
  }
  const out: JSX.Element[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && on[j] === on[i]) j++
    out.push(on[i] ? <mark>{text.slice(i, j)}</mark> : text.slice(i, j))
    i = j
  }
  return out
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
    { type: 'cmd', label: '新しいノート', key: 'Ctrl N', run: () => props.onCreate?.() },
    { type: 'cmd', label: '紙面に戻る', key: '', run: () => props.onGo?.('home') },
    { type: 'cmd', label: 'ショートカットの一覧', key: '?', run: () => setState('help') },
    { type: 'cmd', label: 'テーマを切り替える', key: '', run: toggleTheme },
  ]
  const terms = () => query().trim().toLowerCase().replace(/#\s*/g, '').split(/\s+/).filter(Boolean)
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
    } else {
      const found: { it: Item; sc: number; where: string }[] = []
      for (const it of lib().items) {
        const text = it.kind === 'note' ? plainText(it.blocks ?? []) : ''
        let sc = 0
        const where: string[] = []
        const ok = ts.every((t) => {
          if (it.name.toLowerCase().includes(t)) sc += 3
          else if (it.tags.some((x) => x.toLowerCase().includes(t))) {
            sc += 2
            where.push(`タグ # ${it.tags.find((x) => x.toLowerCase().includes(t))}`)
          } else if (it.folder?.toLowerCase().includes(t)) {
            sc += 1
            where.push(`プロジェクト ${it.folder}`)
          } else if (text.toLowerCase().includes(t)) {
            sc += 1
            const p = text.toLowerCase().indexOf(t)
            where.push(`本文 …${text.slice(Math.max(0, p - 8), p + 16)}…`)
          } else return false
          return true
        })
        if (ok) found.push({ it, sc, where: where.join(' · ') || (it.folder ?? 'プロジェクトなし') })
      }
      for (const f of found.toSorted((a, b) => b.sc - a.sc || a.it.moved - b.it.moved).slice(0, 8))
        out.push({ type: 'item', ...f })
    }
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

  const SEC = { cmd: '操作', proj: 'プロジェクト', item: '項目', create: '' }
  const results = () => (
    <Show when={rows().length} fallback={<ResultHeading>見つかりません</ResultHeading>}>
      <For each={rows()}>
        {(r, i) => {
          const prev = () => rows()[i() - 1]
          const sel = () => i() === idx()
          return (
            <>
              {r.type !== 'create' && prev()?.type !== r.type && <ResultHeading>{SEC[r.type]}</ResultHeading>}
              {r.type === 'cmd' ? (
                <ResultRow
                  kind="command"
                  title={marked(r.label, terms())}
                  kbd={r.key}
                  selected={sel()}
                  onClick={() => run(r)}
                />
              ) : r.type === 'proj' ? (
                <ResultRow
                  kind="project"
                  title={marked(r.p.name, terms())}
                  sub={`${lib().inProject(r.p.name).length} 件 · 最後に扱った ${r.p.touched}`}
                  selected={sel()}
                  onClick={() => run(r)}
                />
              ) : r.type === 'item' ? (
                <ResultRow
                  kind={r.it.kind === 'note' ? 'note' : 'asset'}
                  title={marked(r.it.name, terms())}
                  sub={marked(r.where, terms())}
                  thumb={thumbOf(r.it)}
                  selected={sel()}
                  onClick={() => run(r)}
                />
              ) : (
                <ResultRow
                  kind="create"
                  title={`「${r.q}」という名前でノートを作る`}
                  selected={sel()}
                  onClick={() => run(r)}
                />
              )}
            </>
          )
        }}
      </For>
    </Show>
  )

  const menuItems = (): NavMenuEntry[] =>
    state() === 'settings'
      ? [
          { id: 'back', icon: '‹', label: '設定', heading: true },
          'separator',
          { id: 'theme', icon: '◐', label: 'テーマを切り替える' },
          { id: 'keys', icon: '⌨', label: 'キー操作の一覧', kbd: '?' },
        ]
      : [
          { id: 'home', icon: '⌂', label: 'ホーム', current: props.here === 'home' },
          { id: 'tags', icon: '#', label: 'タグ一覧', count: lib().tagGroups().size, current: props.here === 'tags' },
          {
            id: 'projects',
            icon: '▦',
            label: 'プロジェクト一覧',
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
    setState('closed')
    if (id === 'home' || id === 'tags' || id === 'projects') props.onGo?.(id)
  }

  return (
    <>
      <Show when={props.readOnly && !open()}>
        <div class={styles.ro} role="status">
          <b>読み取り専用</b>
          <span title="保存先に書き込めないため、見るだけになっています">ⓘ</span>
          <button type="button">編集を有効にする</button>
        </div>
      </Show>
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
      <Show when={state() === 'help'}>
        <HelpDialog onClose={close} />
      </Show>
    </>
  )
}
