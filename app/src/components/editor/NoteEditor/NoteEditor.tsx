import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown'
import { EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, type ViewUpdate, keymap } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { EMBED_SCALES, type Item, type Library, hrefOf, plainText, thumbOf } from '../../../model/library'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { LinkPicker } from '../../nav/LinkPicker/LinkPicker'
import { QuickView } from '../../overlay/QuickView/QuickView'
import { type SlashAction, slashMatches } from './commands'
import { runSlash, toggleWrap, unlinkAt } from './edit'
import { type Embed, type LiveHooks, type Ref, escapeLabel, live, marksAt, refAt, refresh } from './live'
import styles from './NoteEditor.module.css'
import { selectionLayer } from './selection'

export type { Embed } from './live'

export interface Point {
  x: number
  y: number
}

export interface NoteEditorApi {
  focus: () => void
  /** 見出しの番号の位置まで送る。-1 ならノートの頭。 */
  scrollToHeading: (index: number) => void
  /** ファイルを落とす先を示す。undefined で消す。 */
  dropAt: (p: Point | undefined) => void
  /** 素材を入れる。動画・音声・画像は埋め込み、ほかはリンクにする。p がなければカーソルの位置に入れる。 */
  insertItems: (items: Item[], p?: Point) => Promise<void>
}

export interface NoteEditorProps {
  lib: Library
  noteId: string
  folder: string | null
  value: string
  onChange?: (markdown: string) => void
  onOpenRef?: (id: string) => void
  onCreateNote?: (name: string) => Promise<Item | undefined>
  embedOf?: (it: Item) => Promise<Embed | undefined>
  /** 貼り付けたり落としたりしたファイルを素材として取り込む。 */
  onImport?: (files: File[]) => Promise<Item[]>
  /** 読んでいる見出しの番号が変わった。見出しより前なら -1。 */
  onSection?: (index: number) => void
  ref?: (api: NoteEditorApi) => void
  class?: string
}

interface At {
  left: number
  top: number
  bottom: number
}

interface Slash extends At {
  query: string
  from: number
  to: number
}

interface Picking {
  embed: boolean
  from: number
  to: number
  /** 閉じたときに戻す文字（`[[` で開いたとき）。 */
  restore?: string
  /** 選んだ文字をリンクの表示名にする。 */
  mark?: boolean
  /** 置き換える埋め込みの大きさ。 */
  scale?: number
}

interface Hover extends At {
  id: string
}

const BAR: { mark: string; icon: IconName; label: string; wrap: string }[] = [
  { mark: 'strong', icon: 'bold', label: '太字', wrap: '**' },
  { mark: 'emphasis', icon: 'italic', label: '斜体', wrap: '*' },
  { mark: 'strike', icon: 'strike', label: '取り消し線', wrap: '~~' },
  { mark: 'code', icon: 'code', label: 'コード', wrap: '`' },
]

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE_RE = /^ {0,3}(```|~~~)/

/** 見出しの行の頭。見出しの一覧（headingsOf）と同じ数え方。 */
function headingLines(state: EditorState) {
  const out: number[] = []
  let fence = false
  for (let l = 1; l <= state.doc.lines; l++) {
    const line = state.doc.line(l)
    if (FENCE_RE.test(line.text)) fence = !fence
    if (fence) continue
    const m = HEADING_RE.exec(line.text)
    if (m?.[1] && m[2]) out.push(line.from)
  }
  return out
}

const SECTION_TOP = 120

/** 本文を送っている要素。エディタは自分では送らず、置かれた画面の側で送る。 */
function scrollerOf(v: EditorView) {
  for (let el = v.dom.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return undefined
}

const refText = (it: Item, embed: boolean, scale?: number) =>
  `${embed ? '!' : ''}[${escapeLabel(it.name)}](${hrefOf(it.id, scale)})`

/** 埋め込みの左右の空き（NoteEditor.module.css の .embed の margin）。 */
const EMBED_GAP = 12

/**
 * 埋め込みに選べる大きさ。本文の幅を超えるものは出さない。
 * 本文の幅いっぱいに描くものは 100% まで、画像はふだんの大きさ（高さ 520px・本文の幅まで）から数える。
 */
function scalesOf(embed: HTMLElement, width: number) {
  if (embed.dataset.wide === 'true') return EMBED_SCALES.filter((s) => s <= 100)
  const img = embed.querySelector('img')
  if (!img?.naturalWidth || !img.naturalHeight) return []
  const base = Math.min(img.naturalWidth, width, (520 * img.naturalWidth) / img.naturalHeight)
  return EMBED_SCALES.filter((s) => (base * s) / 100 <= width + 0.5)
}

const coords = (v: EditorView, pos: number): At | undefined => {
  const c = v.coordsAtPos(pos)
  return c ? { left: c.left, top: c.top, bottom: c.bottom } : undefined
}

const posOf = (v: EditorView, p?: Point) =>
  (p && v.posAtCoords({ x: p.x, y: p.y }, false)) ?? v.state.selection.main.head

const markKeys = (wrap: string) => (v: EditorView) => toggleWrap(v, wrap)

export function NoteEditor(props: NoteEditorProps) {
  let root!: HTMLDivElement
  let view: EditorView | undefined
  let last = props.value
  let timer: ReturnType<typeof setTimeout> | undefined
  const [slash, setSlash] = createSignal<Slash>()
  const [slashIdx, setSlashIdx] = createSignal(0)
  const [selected, setSelected] = createSignal<At & { marks: string[] }>()
  const [picking, setPicking] = createSignal<Picking>()
  const [active, setActive] = createSignal<Ref & At>()
  const [hover, setHover] = createSignal<Hover>()
  const [caret, setCaret] = createSignal<At>()
  const items = () => slashMatches(slash()?.query ?? '')

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const md = view?.state.doc.toString()
    if (md === undefined || md === last) return
    last = md
    props.onChange?.(md)
  }

  const hooks: LiveHooks = {
    nameOf: (id) => props.lib.byId.get(id)?.name,
    embedOf: async (id) => {
      const it = props.lib.byId.get(id)
      return it && props.embedOf ? props.embedOf(it) : undefined
    },
    onOpenRef: (id) => props.onOpenRef?.(id),
    classes: styles,
  }

  /** カーソルや選んでいる範囲に合わせて、浮かべる部品を出し直す。 */
  let slashFrom: number | undefined
  const place = (v: EditorView, typed: boolean) => {
    const { state } = v
    const sel = state.selection.main
    const focused = v.hasFocus
    const c = !sel.empty && focused ? coords(v, sel.from) : undefined
    setSelected(c && { ...c, marks: marksAt(state, sel.from, sel.to) })
    const r = sel.empty && focused ? refAt(state, sel.head) : undefined
    const rc = r && coords(v, r.from)
    setActive(r && rc ? { ...r, ...rc } : undefined)
    const close = () => {
      slashFrom = undefined
      setSlash(undefined)
    }
    if (!sel.empty || !focused || v.composing) return close()
    const line = state.doc.lineAt(sel.head)
    const before = state.sliceDoc(line.from, sel.head)
    const m = /(?:^|\s)\/([^\s/]*)$/.exec(before)
    const from = m ? sel.head - (m[1]?.length ?? 0) - 1 : undefined
    if (from === undefined || (slashFrom !== from && !(typed && m?.[1] === ''))) return close()
    const sc = coords(v, from)
    if (!sc) return close()
    if (slashFrom !== from) setSlashIdx(0)
    slashFrom = from
    setSlash({ ...sc, query: m?.[1] ?? '', from, to: sel.head })
    return undefined
  }

  /** カーソルが出たリンクの表示名を、リンク先のいまの名前にする。 */
  let left: Ref | undefined
  const rename = (u: ViewUpdate) => {
    const prev = left && { ...left, from: u.changes.mapPos(left.from), to: u.changes.mapPos(left.to, 1) }
    const now =
      u.view.hasFocus && u.state.selection.main.empty ? refAt(u.state, u.state.selection.main.head) : undefined
    left = now
    if (!prev?.id || (now && now.from === prev.from) || u.view.composing) return
    const r = refAt(u.state, prev.from + 1)
    const name = r?.id && hooks.nameOf(r.id)
    if (!r || r.from !== prev.from || !name) return
    const label = escapeLabel(name)
    if (u.state.sliceDoc(r.label.from, r.label.to) === label) return
    const ev = u.view
    queueMicrotask(() => ev.dispatch({ changes: { from: r.label.from, to: r.label.to, insert: label } }))
  }

  const onUpdate = (u: ViewUpdate) => {
    if (u.docChanged) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 150)
    }
    if (u.docChanged || u.selectionSet || u.focusChanged) rename(u)
    const typed = u.transactions.some((t) => t.isUserEvent('input.type'))
    const sel = u.state.selection.main
    if (typed && sel.empty && u.state.sliceDoc(sel.head - 2, sel.head) === '[[') {
      const from = sel.head - 2
      const ev = u.view
      queueMicrotask(() => {
        ev.dispatch({ changes: { from, to: from + 2 } })
        setPicking({ embed: false, from, to: from, restore: '[[' })
      })
      return
    }
    if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || u.geometryChanged) {
      const ev = u.view
      ev.requestMeasure({ read: () => place(ev, u.docChanged && typed), key: 'patchouli-place' })
    }
    if (u.docChanged || u.geometryChanged) {
      const ev = u.view
      ev.requestMeasure({ read: () => findSection(ev), key: 'patchouli-section' })
    }
  }

  /**
   * 読んでいる見出しを、見えている範囲の上の端近く（SECTION_TOP まで）に頭が来た最後の見出しにする。
   * 終わりまで送ったときは、それより下の見出しはそこまで上がってこないので、見えている最後の見出しにする。
   */
  let section: number | undefined
  let pinned = false
  const unpin = () => (pinned = false)
  const findSection = (v: EditorView) => {
    const el = scrollerOf(v)
    if (!el || !props.onSection || pinned) return
    const r = el.getBoundingClientRect()
    const end = el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    const line = end ? r.bottom : r.top + SECTION_TOP
    let at = -1
    headingLines(v.state).forEach((pos, i) => {
      if (v.lineBlockAt(pos).top + v.documentTop <= line) at = i
    })
    if (at === section) return
    section = at
    props.onSection(at)
  }

  const takeFiles = (data: DataTransfer | null, at: number) => {
    const files = [...(data?.files ?? [])]
    const take = props.onImport
    if (!files.length || !take || data?.getData('text/plain')) return false
    void take(files).then((list) => insertItems(list, at))
    return true
  }

  const insertItems = async (list: Item[], at: number) => {
    const kinds = await Promise.all(list.map(async (it) => (await props.embedOf?.(it))?.kind))
    const v = view
    if (!v || !list.length) return
    const text = list.map((it, i) => refText(it, !!kinds[i] && kinds[i] !== 'card')).join(' ')
    const pos = Math.min(at, v.state.doc.length)
    v.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, scrollIntoView: true })
    v.focus()
  }

  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  const hoverOn = (el: Element | null) => {
    if (hoverTimer) clearTimeout(hoverTimer)
    const id = el instanceof HTMLElement ? el.dataset.ref : undefined
    if (!el || !id) {
      hoverTimer = setTimeout(() => setHover(undefined), 120)
      return
    }
    if (hover()?.id === id) return
    hoverTimer = setTimeout(() => {
      const r = el.getBoundingClientRect()
      setHover({ id, left: r.left, top: r.top, bottom: r.bottom })
    }, 250)
  }

  const menuKey = (key: string) => () => {
    if (!slash()) return false
    const n = items().length
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (n) setSlashIdx((slashIdx() + (key === 'ArrowDown' ? 1 : n - 1)) % n)
      return true
    }
    if (key === 'Enter' || key === 'Tab') {
      const it = items()[slashIdx()]
      if (!it) return false
      chooseSlash(it.action)
      return true
    }
    setSlash(undefined)
    return true
  }

  onMount(() => {
    view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          history(),
          markdown({ base: commonmarkLanguage, extensions: [GFM] }),
          Prec.highest(
            keymap.of(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].map((key) => ({ key, run: menuKey(key) }))),
          ),
          keymap.of([
            { key: 'Mod-b', run: markKeys('**') },
            { key: 'Mod-i', run: markKeys('*') },
            { key: 'Mod-e', run: markKeys('`') },
            { key: 'Mod-Alt-x', run: markKeys('~~') },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': '本文' }),
          live(() => hooks),
          selectionLayer(styles.selection ?? ''),
          EditorView.updateListener.of(onUpdate),
          EditorView.domEventHandlers({
            mousedown: (e) => {
              if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
              const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-ref]') : null
              const id = el?.dataset.ref
              if (!id) return false
              e.preventDefault()
              setHover(undefined)
              props.onOpenRef?.(id)
              return true
            },
            mouseover: (e) => {
              const el = e.target instanceof Element ? e.target.closest('[data-ref]') : null
              // 埋め込みは中身がもう見えているので、浮かべない
              hoverOn(el?.classList.contains(styles.embed) ? null : el)
            },
            mouseleave: () => hoverOn(null),
            keydown: () => {
              setHover(undefined)
              return false
            },
            paste: (e, v) => {
              if (!takeFiles(e.clipboardData, v.state.selection.main.from)) return false
              e.preventDefault()
              v.dispatch(v.state.replaceSelection(''))
              return true
            },
            drop: (e, v) => {
              if (!takeFiles(e.dataTransfer, posOf(v, { x: e.clientX, y: e.clientY }))) return false
              e.preventDefault()
              return true
            },
            blur: () => {
              flush()
              return false
            },
          }),
        ],
      }),
    })
    props.ref?.({
      focus: () => view?.focus(),
      scrollToHeading: (i) => {
        const v = view
        if (!v) return
        const el = scrollerOf(v)
        if (!el) return
        const at = headingLines(v.state)[i]
        // 送ったあとは、自分で送るか打つまで、選んだ見出しを読んでいる見出しにする
        pinned = true
        section = at === undefined ? -1 : i
        props.onSection?.(section)
        if (at === undefined) {
          el.scrollTo({ top: 0 })
          return
        }
        // 上に重なる帯に隠れないよう、少し下に置く。まだ描いていない行の高さは見積もりなので、描いてから合わせ直す
        const topOf = () => {
          const { node } = v.domAtPos(at)
          const line = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line')
          return line && at >= v.viewport.from && at <= v.viewport.to
            ? line.getBoundingClientRect().top
            : v.lineBlockAt(at).top + v.documentTop
        }
        const go = (tries: number) => {
          const off = topOf() - el.getBoundingClientRect().top - SECTION_TOP / 2
          if (Math.abs(off) < 2) return
          const before = el.scrollTop
          el.scrollTo({ top: before + off })
          if (tries > 0 && el.scrollTop !== before) requestAnimationFrame(() => go(tries - 1))
        }
        go(6)
      },
      dropAt: (p) => {
        const v = view
        const pos = p && v?.posAtCoords({ x: p.x, y: p.y }, false)
        setCaret(pos === undefined || pos === null || !v ? undefined : coords(v, pos))
      },
      insertItems: async (list, p) => {
        setCaret(undefined)
        const v = view
        if (v) await insertItems(list, posOf(v, p))
      },
    })
  })

  onCleanup(() => {
    flush()
    if (hoverTimer) clearTimeout(hoverTimer)
    view?.destroy()
    view = undefined
  })

  createEffect(
    on(
      () => props.value,
      (val) => {
        const v = view
        if (!v || val === last || val === v.state.doc.toString()) return
        last = val
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: val },
          annotations: Transaction.addToHistory.of(false),
        })
        setSlash(undefined)
        setPicking(undefined)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.lib,
      () => view?.dispatch({ effects: refresh.of(null) }),
      { defer: true },
    ),
  )

  let frame = 0
  const onScroll = () => {
    setHover(undefined)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const v = view
      if (!v) return
      place(v, false)
      findSection(v)
    })
  }
  const UNPIN = ['wheel', 'keydown', 'touchmove', 'pointerdown'] as const
  onMount(() => {
    document.addEventListener('scroll', onScroll, true)
    for (const t of UNPIN) document.addEventListener(t, unpin, { capture: true, passive: true })
  })
  onCleanup(() => {
    document.removeEventListener('scroll', onScroll, true)
    for (const t of UNPIN) document.removeEventListener(t, unpin, { capture: true })
    cancelAnimationFrame(frame)
  })

  const chooseSlash = (a: SlashAction) => {
    const s = slash()
    const v = view
    if (!s || !v) return
    setSlash(undefined)
    v.dispatch({ changes: { from: s.from, to: s.to } })
    if (a.type === 'link' || a.type === 'embed') {
      setPicking({ embed: a.type === 'embed', from: s.from, to: s.from })
      return
    }
    runSlash(v, a)
    v.focus()
  }

  const closePicker = () => {
    const p = picking()
    setPicking(undefined)
    const v = view
    if (!v || !p) return
    const insert = p.restore ?? ''
    v.dispatch({ changes: { from: p.from, insert }, selection: { anchor: p.from + insert.length } })
    v.focus()
  }

  const insertRef = (it: Item) => {
    const p = picking()
    setPicking(undefined)
    const v = view
    if (!v || !p) return
    const text = p.mark ? `[${v.state.sliceDoc(p.from, p.to)}](${hrefOf(it.id)})` : refText(it, p.embed, p.scale)
    v.dispatch({
      changes: { from: p.from, to: p.to, insert: text },
      selection: { anchor: p.from + text.length },
      scrollIntoView: true,
    })
    v.focus()
  }

  const linkSelection = () => {
    const v = view
    if (!v) return
    const { from, to } = v.state.selection.main
    if (unlinkAt(v, from, to)) return
    setPicking({ embed: false, from, to, mark: true })
  }

  const [sizing, setSizing] = createSignal(false)
  const activeAt = createMemo(() => active()?.from)
  createEffect(on(activeAt, () => setSizing(false)))
  const scales = (r: Ref) => {
    const el =
      r.id && root.querySelector<HTMLElement>(`.${styles.embed}[data-ref="${CSS.escape(r.id)}"][data-selected="true"]`)
    return el ? scalesOf(el, root.clientWidth - EMBED_GAP) : []
  }
  const resize = (r: Ref, scale: number) => {
    const v = view
    if (!v || !r.id) return
    v.dispatch({ changes: { from: r.url.from, to: r.url.to, insert: hrefOf(r.id, scale) } })
    v.focus()
  }

  /** ホバーしているリンク先。カーソルのあるリンクはメニューを出すので浮かべない。 */
  const shown = () => {
    const h = hover()
    return h && h.id !== active()?.id ? { id: h.id, left: h.left, top: h.bottom + 6 } : undefined
  }

  return (
    <>
      <div ref={root} class={`${styles.root} ${props.class ?? ''}`} />
      <Show when={caret()}>
        {(c) => (
          <div
            class={styles.caret}
            style={{ left: `${c().left}px`, top: `${c().top}px`, height: `${c().bottom - c().top}px` }}
          />
        )}
      </Show>
      <Show when={slash() && items().length ? slash() : undefined}>
        {(s) => (
          <div
            class={styles.menu}
            role="listbox"
            tabIndex={-1}
            aria-label="書式"
            style={{ left: `${s().left}px`, top: `${s().bottom + 6}px` }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <For each={items()}>
              {(it, i) => (
                // キー操作は本文の ↑↓ Enter が受け持つので、行はマウスで押せるだけにする
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  class={styles.item}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i() === slashIdx()}
                  onMouseEnter={() => setSlashIdx(i())}
                  onClick={() => chooseSlash(it.action)}
                >
                  <Icon name={it.icon} withText />
                  {it.label}
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={!picking() && !selected() && active()?.id ? active() : undefined}>
        {(r) => {
          const embed = () => r().kind === 'embed'
          // 埋め込みは中身を隠さないよう上に出す。上が狭いときだけ下に出す
          const above = () => embed() && r().top > 80
          return (
            <div
              class={styles.linkMenu}
              role="toolbar"
              tabIndex={-1}
              aria-label={embed() ? '埋め込み' : 'リンク'}
              style={{
                left: `${r().left}px`,
                top: `${above() ? r().top - 6 : r().bottom + 6}px`,
                transform: above() ? 'translateY(-100%)' : undefined,
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button type="button" onClick={() => props.onOpenRef?.(r().id ?? '')}>
                開く
              </button>
              <button
                type="button"
                onClick={() => setPicking({ embed: embed(), from: r().from, to: r().to, scale: r().scale })}
              >
                アセットを選択
              </button>
              <Show when={embed() && scales(r()).length > 1}>
                <button type="button" aria-expanded={sizing()} onClick={() => setSizing(!sizing())}>
                  サイズを変更
                </button>
                <Show when={sizing()}>
                  <span class={styles.menuSep} />
                  <For each={scales(r())}>
                    {(s) => (
                      <button type="button" aria-pressed={r().scale === s} onClick={() => resize(r(), s)}>
                        {s}%
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
              <Show when={!embed()}>
                <button
                  type="button"
                  onClick={() => {
                    const v = view
                    if (!v) return
                    unlinkAt(v, r().from, r().to)
                    v.focus()
                  }}
                >
                  リンクを解除
                </button>
              </Show>
            </div>
          )
        }}
      </Show>
      <Show when={!selected() && shown()}>
        {(s) => {
          const it = () => props.lib.byId.get(s().id)
          return (
            <QuickView
              id={s().id}
              name={it()?.name}
              kind={it()?.note ? 'ノート' : it()?.ext.toUpperCase()}
              text={it()?.note ? plainText(it()?.body ?? '').slice(0, 240) : undefined}
              thumb={(() => {
                const x = it()
                return x && !x.note ? thumbOf(x, 'L') : undefined
              })()}
              left={s().left}
              top={s().top}
            />
          )
        }}
      </Show>
      <Show when={!picking() && selected()}>
        {(s) => (
          <div
            class={styles.bar}
            role="toolbar"
            tabIndex={-1}
            aria-label="書式"
            style={{ left: `${s().left}px`, top: `${s().top - 8}px` }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <For each={BAR}>
              {(b) => (
                <button
                  type="button"
                  title={b.label}
                  aria-label={b.label}
                  aria-pressed={s().marks.includes(b.mark)}
                  onClick={() => view && toggleWrap(view, b.wrap)}
                >
                  <Icon name={b.icon} />
                </button>
              )}
            </For>
            <button
              type="button"
              title="リンク"
              aria-label="リンク"
              aria-pressed={s().marks.includes('link')}
              onClick={linkSelection}
            >
              <Icon name="link" />
            </button>
          </div>
        )}
      </Show>
      <Show when={picking()}>
        {(p) => (
          <LinkPicker
            lib={props.lib}
            embed={p().embed}
            folder={props.folder}
            exclude={props.noteId}
            onPick={insertRef}
            onCreate={
              props.onCreateNote &&
              ((name) => {
                void props.onCreateNote?.(name).then((it) => (it ? insertRef(it) : closePicker()))
              })
            }
            onClose={() => closePicker()}
          />
        )}
      </Show>
    </>
  )
}
