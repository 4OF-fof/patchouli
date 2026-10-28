import {
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  defaultValueCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import {
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  insertHrCommand,
  linkSchema,
  remarkPreserveEmptyLinePlugin,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { gfm, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { callCommand, replaceAll } from '@milkdown/kit/utils'
import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import { type Item, LINK_SCHEME, type Library } from '../../../model/library'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { LinkPicker } from '../../nav/LinkPicker/LinkPicker'
import { type SlashAction, slashMatches } from './commands'
import {
  type At,
  type Embed,
  type Hooks,
  type Selected,
  type Slash,
  codeBlocks,
  diagramEditing,
  embeds,
  escapeLabel,
  links,
  patchouliImage,
  patchouliLink,
  type RawLink,
  rawMarks,
  refreshLinks,
  savedDoc,
  textInput,
  triggers,
  unlinkRaw,
} from './prose'
import styles from './NoteEditor.module.css'

export type { Embed } from './prose'

export interface Point {
  x: number
  y: number
}

export interface NoteEditorApi {
  focus: () => void
  scrollToHeading: (index: number) => void
  pickLink: () => void
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
  ref?: (api: NoteEditorApi) => void
  class?: string
}

interface Picking {
  embed: boolean
  from: number
  to: number
  /** 閉じたときに戻す文字（`[[` で開いたとき）。 */
  restore?: string
  /** 選んだ文字にリンクを付ける。 */
  mark?: boolean
  /** 元の書き方に戻しているリンクを、選んだ素材へのリンクの書き方に置き換える。 */
  raw?: boolean
}

const BAR: { mark: string; icon: IconName; label: string; run: () => ReturnType<typeof callCommand> }[] = [
  { mark: 'strong', icon: 'bold', label: '太字', run: () => callCommand(toggleStrongCommand.key) },
  { mark: 'emphasis', icon: 'italic', label: '斜体', run: () => callCommand(toggleEmphasisCommand.key) },
  {
    mark: 'strike_through',
    icon: 'strike',
    label: '取り消し線',
    run: () => callCommand(toggleStrikethroughCommand.key),
  },
  { mark: 'inlineCode', icon: 'code', label: 'コード', run: () => callCommand(toggleInlineCodeCommand.key) },
]

const posOf = (v: EditorView, p?: Point) => (p && v.posAtCoords({ left: p.x, top: p.y })?.pos) ?? v.state.selection.from

export function NoteEditor(props: NoteEditorProps) {
  let root!: HTMLDivElement
  let editor: Editor | undefined
  let base: Node | undefined
  let baseValue = props.value
  let last = props.value
  const [slash, setSlash] = createSignal<Slash>()
  const [slashIdx, setSlashIdx] = createSignal(0)
  const [selected, setSelected] = createSignal<Selected>()
  const [picking, setPicking] = createSignal<Picking>()
  const [raw, setRaw] = createSignal<RawLink>()
  const items = () => slashMatches(slash()?.query ?? '')

  const act = <T,>(f: (ctx: Ctx) => T) => editor?.action(f)
  const view = () => act((ctx) => ctx.get(editorViewCtx))
  const emit = (md: string, doc: Node) => {
    if (base && doc.eq(base) && last === baseValue) return
    if (md === last) return
    last = md
    props.onChange?.(md)
  }

  const runSlash = (a: SlashAction) => {
    const s = slash()
    const v = view()
    if (!s || !v) return
    setSlash(undefined)
    v.dispatch(v.state.tr.delete(s.from, s.to))
    if (a.type === 'link' || a.type === 'embed') {
      setPicking({ embed: a.type === 'embed', from: s.from, to: s.from })
      return
    }
    act((ctx) => {
      if (a.type === 'heading') callCommand(wrapInHeadingCommand.key, a.level)(ctx)
      else if (a.type === 'bullets' || a.type === 'tasks') callCommand(wrapInBulletListCommand.key)(ctx)
      else if (a.type === 'numbers') callCommand(wrapInOrderedListCommand.key)(ctx)
      else if (a.type === 'quote') callCommand(wrapInBlockquoteCommand.key)(ctx)
      else if (a.type === 'code') callCommand(createCodeBlockCommand.key)(ctx)
      else if (a.type === 'diagram') callCommand(createCodeBlockCommand.key, 'mermaid')(ctx)
      else if (a.type === 'table') callCommand(insertTableCommand.key, { row: 3, col: 3 })(ctx)
      else if (a.type === 'rule') callCommand(insertHrCommand.key)(ctx)
      if (a.type === 'tasks') {
        const ev = ctx.get(editorViewCtx)
        const { $from } = ev.state.selection
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d)
          if (n.type.name !== 'list_item') continue
          ev.dispatch(ev.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, checked: false }))
          break
        }
      }
    })
    v.focus()
  }

  const hooks: Hooks = {
    onLinkTrigger: (from, to) => {
      queueMicrotask(() => {
        const v = view()
        if (!v) return
        v.dispatch(v.state.tr.delete(from, to))
        setPicking({ embed: false, from, to: from, restore: '[[' })
      })
    },
    onSlash: (s) => {
      if (s?.from !== slash()?.from) setSlashIdx(0)
      setSlash(s)
    },
    onSelect: (s) => setSelected(s),
    onMenuKey: (e) => {
      if (!slash()) return false
      const n = items().length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (n) setSlashIdx((slashIdx() + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = items()[slashIdx()]
        if (!it) return false
        runSlash(it.action)
        return true
      }
      if (e.key === 'Escape') {
        setSlash(undefined)
        return true
      }
      return false
    },
    onOpenRef: (id) => props.onOpenRef?.(id),
    onRaw: (r) => setRaw(r),
    nameOf: (id) => props.lib.byId.get(id)?.name,
    embedOf: async (id) => {
      const it = props.lib.byId.get(id)
      return it && props.embedOf ? props.embedOf(it) : undefined
    },
    classes: {
      link: styles.link,
      missing: styles.missing,
      embed: styles.embed,
      card: styles.card,
      diagram: styles.diagram,
      editing: styles.editing,
      raw: styles.raw,
    },
  }

  const closePicker = (v?: EditorView) => {
    const p = picking()
    setPicking(undefined)
    const ev = v ?? view()
    if (!ev || !p) return
    let tr = ev.state.tr
    if (p.restore) tr = tr.insertText(p.restore, p.from)
    const pos = Math.min(p.from + (p.restore?.length ?? 0), tr.doc.content.size)
    ev.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)))
    ev.focus()
  }

  const insertRef = (it: Item) => {
    const p = picking()
    setPicking(undefined)
    act((ctx) => {
      const ev = ctx.get(editorViewCtx)
      if (!p) return
      const href = LINK_SCHEME + it.id
      const link = linkSchema.type(ctx)
      let tr = ev.state.tr
      if (p.raw) {
        const s = `[${escapeLabel(it.name)}](${href})`
        tr = tr.insertText(s, p.from, p.to)
        tr = tr.setSelection(TextSelection.create(tr.doc, p.from + s.length))
      } else if (p.embed) {
        tr = tr.replaceWith(p.from, p.to, imageSchema.type(ctx).create({ src: href, alt: it.name }))
      } else if (p.mark) {
        tr = tr.addMark(p.from, p.to, link.create({ href }))
      } else {
        const end = p.from + it.name.length
        tr = tr.insertText(it.name, p.from, p.to).addMark(p.from, end, link.create({ href }))
        tr = tr.setSelection(TextSelection.create(tr.doc, end)).removeStoredMark(link)
      }
      ev.dispatch(tr.scrollIntoView())
      ev.focus()
    })
  }

  const insertItems = async (list: Item[], at: number) => {
    const kinds = await Promise.all(list.map(async (it) => (await props.embedOf?.(it))?.kind))
    act((ctx) => {
      const ev = ctx.get(editorViewCtx)
      const { schema } = ev.state
      const link = linkSchema.type(ctx)
      const nodes = list.flatMap((it, i) => {
        const href = LINK_SCHEME + it.id
        const kind = kinds[i]
        const n =
          kind && kind !== 'card'
            ? imageSchema.type(ctx).create({ src: href, alt: it.name })
            : schema.text(it.name, [link.create({ href })])
        return i ? [schema.text(' '), n] : [n]
      })
      if (!nodes.length) return
      const tr = ev.state.tr.insert(Math.min(at, ev.state.doc.content.size), Fragment.from(nodes))
      ev.dispatch(tr.removeStoredMark(link).scrollIntoView())
      ev.focus()
    })
  }

  const takeFiles = (data: DataTransfer | null, at: number) => {
    const files = [...(data?.files ?? [])]
    const take = props.onImport
    if (!files.length || !take || data?.getData('text/plain')) return false
    void take(files).then((list) => insertItems(list, at))
    return true
  }

  const [caret, setCaret] = createSignal<At>()
  const dropAt = (p: Point | undefined) => {
    const v = view()
    const pos = p && v?.posAtCoords({ left: p.x, top: p.y })?.pos
    const c = pos === undefined ? undefined : v?.coordsAtPos(pos)
    setCaret(c && { left: c.left, top: c.top, bottom: c.bottom })
  }

  const linkSelection = () => {
    const v = view()
    if (!v) return
    const { from, to } = v.state.selection
    const link = act((ctx) => linkSchema.type(ctx))
    if (link && v.state.doc.rangeHasMark(from, to, link)) {
      v.dispatch(v.state.tr.removeMark(from, to, link))
      return
    }
    setPicking({ embed: false, from, to, mark: true })
  }

  onMount(async () => {
    const e = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, props.value)
        ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: '-' as const, rule: '-' as const }))
        ctx.update(editorViewOptionsCtx, (o) => ({
          ...o,
          attributes: { class: styles.pm ?? '', spellcheck: 'false' },
          handlePaste: (v, ev) => {
            const at = v.state.selection.from
            if (!takeFiles(ev.clipboardData, at)) return false
            v.dispatch(v.state.tr.deleteSelection())
            return true
          },
          handleDrop: (v, ev) => takeFiles(ev.dataTransfer, posOf(v, { x: ev.clientX, y: ev.clientY })),
          handleTextInput: (v, from, to, text) => textInput(v, from, to, text),
        }))
        // 渡される文字は、元の書き方に戻した書式をそのまま書いたものなので使わない
        ctx.get(listenerCtx).updated((c) => {
          const doc = savedDoc(c, c.get(editorViewCtx).state, hooks.nameOf)
          emit(c.get(serializerCtx)(doc), doc)
        })
      })
      // 空の段落を <br /> で書き出す仕組みを外す
      .use(commonmark.filter((p) => !remarkPreserveEmptyLinePlugin.includes(p)))
      .use(patchouliLink)
      .use(patchouliImage)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(triggers(() => hooks))
      .use(links(() => hooks))
      .use(embeds(() => hooks))
      .use(codeBlocks(() => hooks))
      .use(diagramEditing(() => hooks))
      .use(rawMarks(() => hooks))
    await e.create()
    editor = e
    base = view()?.state.doc
    props.ref?.({
      focus: () => view()?.focus(),
      scrollToHeading: (i) => root.querySelectorAll('h1, h2, h3, h4, h5, h6')[i]?.scrollIntoView({ block: 'start' }),
      pickLink: () => {
        const v = view()
        if (!v) return
        const { from, to, empty } = v.state.selection
        setPicking({ embed: false, from, to, mark: !empty })
      },
      dropAt,
      insertItems: async (list, p) => {
        setCaret(undefined)
        const v = view()
        if (v) await insertItems(list, posOf(v, p))
      },
    })
  })

  onCleanup(() => {
    const e = editor
    editor = undefined
    if (!e) return
    e.action((ctx) => {
      const doc = savedDoc(ctx, ctx.get(editorViewCtx).state, hooks.nameOf)
      emit(ctx.get(serializerCtx)(doc), doc)
    })
    void e.destroy()
  })

  createEffect(
    on(
      () => props.value,
      (v) => {
        if (!editor || v === last) return
        baseValue = v
        last = v
        editor.action(replaceAll(v))
        base = view()?.state.doc
        setSlash(undefined)
        setPicking(undefined)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.lib,
      () => {
        const v = view()
        if (v) refreshLinks(v)
      },
      { defer: true },
    ),
  )

  let frame = 0
  const onScroll = () => {
    if (frame || (!slash() && !selected())) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const v = view()
      if (v) v.dispatch(v.state.tr)
    })
  }
  onMount(() => document.addEventListener('scroll', onScroll, true))
  onCleanup(() => {
    document.removeEventListener('scroll', onScroll, true)
    cancelAnimationFrame(frame)
  })

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
                  onClick={() => runSlash(it.action)}
                >
                  <Icon name={it.icon} />
                  {it.label}
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={!picking() && !selected() && raw()?.link ? raw() : undefined}>
        {(r) => (
          <div
            class={styles.linkMenu}
            role="toolbar"
            tabIndex={-1}
            aria-label="リンク"
            style={{ left: `${r().left}px`, top: `${r().bottom + 6}px` }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" onClick={() => props.onOpenRef?.(r().link?.id ?? '')}>
              開く
            </button>
            <button
              type="button"
              onClick={() => {
                const l = r().link
                if (l) setPicking({ embed: false, from: l.from, to: l.to, raw: true })
              }}
            >
              アセットを選択
            </button>
            <button
              type="button"
              onClick={() => {
                const v = view()
                if (!v) return
                act((ctx) => unlinkRaw(ctx, v, hooks.nameOf))
                v.focus()
              }}
            >
              リンクを解除
            </button>
          </div>
        )}
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
                  onClick={() => act(b.run())}
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
