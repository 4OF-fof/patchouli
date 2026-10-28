import { parserCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { codeBlockSchema, imageSchema, linkSchema } from '@milkdown/kit/preset/commonmark'
import type { Mounted } from 'pele/lazy'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Transform } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { LINK_SCHEME } from '../../../model/library'

export const idOfHref = (href: unknown) =>
  typeof href === 'string' && href.startsWith(LINK_SCHEME) ? href.slice(LINK_SCHEME.length) : undefined

export interface At {
  left: number
  top: number
  bottom: number
}

export interface Slash extends At {
  query: string
  from: number
  to: number
}

export interface Selected extends At {
  marks: string[]
}

export type Embed = { kind: 'image' | 'video' | 'audio'; src: string } | { kind: 'card'; thumb?: string }

export interface Hooks {
  onLinkTrigger: (from: number, to: number) => void
  onSlash: (s: Slash | undefined) => void
  onSelect: (s: Selected | undefined) => void
  /** `/` の一覧が開いているときのキー。受け持ったら true。 */
  onMenuKey: (e: KeyboardEvent) => boolean
  onOpenRef: (id: string) => void
  /** カーソルが入って元の書き方に戻しているリンク。 */
  onRaw: (r: RawLink | undefined) => void
  nameOf: (id: string) => string | undefined
  embedOf: (id: string) => Promise<Embed | undefined>
  classes: {
    link: string
    missing: string
    embed: string
    card: string
    diagram: string
    editing: string
    raw: string
  }
}

const at = (view: EditorView, pos: number): At => {
  const c = view.coordsAtPos(pos)
  return { left: c.left, top: c.top, bottom: c.bottom }
}

function marksIn(state: EditorState) {
  const { from, to } = state.selection
  const out = new Set<string>()
  state.doc.nodesBetween(from, to, (n) => {
    for (const m of n.marks) out.add(m.type.name)
  })
  return [...out]
}

export const triggers = (hooks: () => Hooks) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('patchouli-triggers'),
        view: () => {
          let slashFrom: number | undefined
          return {
            update(view, prev) {
              const h = hooks()
              const { state } = view
              const sel = state.selection
              h.onSelect(
                !sel.empty && sel instanceof TextSelection && view.hasFocus() && !inRaw(state)
                  ? { ...at(view, sel.from), marks: marksIn(state) }
                  : undefined,
              )
              if (view.composing) return
              const close = () => {
                slashFrom = undefined
                h.onSlash(undefined)
              }
              const { $from } = sel
              if (!sel.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return close()
              const typed = !prev.doc.eq(state.doc)
              const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
              if (typed && before.endsWith('[[')) {
                close()
                h.onLinkTrigger(sel.from - 2, sel.from)
                return
              }
              const m = /(?:^|\s)\/([^\s/]*)$/.exec(before)
              const from = m ? sel.from - (m[1]?.length ?? 0) - 1 : undefined
              if (from === undefined || (slashFrom !== from && !(typed && m?.[1] === ''))) return close()
              slashFrom = from
              h.onSlash({ ...at(view, from), query: m?.[1] ?? '', from, to: sel.from })
            },
          }
        },
        props: {
          handleKeyDown: (view, e) => !view.composing && !e.isComposing && hooks().onMenuKey(e),
          handleDOMEvents: {
            blur: () => {
              hooks().onSelect(undefined)
              return false
            },
          },
        },
      }),
  )

/** Milkdown は知らないスキームの href を描くときに消すので、patchouli: のリンクだけはそのまま残す。 */
export const patchouliLink = linkSchema.extendSchema((prev) => (ctx) => {
  const s = prev(ctx)
  return {
    ...s,
    toDOM: (mark, inline) =>
      idOfHref(mark.attrs.href) ? ['a', { ...mark.attrs }] : (s.toDOM?.(mark, inline) ?? ['a']),
  }
})

/** 題のない画像は title が null で届き、属性の検査に通らず消えるので、空の文字にする。 */
export const patchouliImage = imageSchema.extendSchema((prev) => (ctx) => {
  const s = prev(ctx)
  return {
    ...s,
    parseMarkdown: {
      ...s.parseMarkdown,
      runner: (state, node, type) =>
        state.addNode(type, {
          src: node.url ?? '',
          alt: node.alt ?? '',
          title: node.title ?? '',
        }),
    },
  }
})

const linkKey = new PluginKey<DecorationSet>('patchouli-links')

/** 名前や素材が変わったときに、リンクの見た目を作り直す。 */
export const refreshLinks = (view: EditorView) => view.dispatch(view.state.tr.setMeta(linkKey, true))

function linkMarks(doc: Node, { classes, nameOf }: Hooks) {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const m of node.marks) {
      const id = m.type.name === 'link' ? idOfHref(m.attrs.href) : undefined
      if (!id) continue
      out.push(
        Decoration.inline(
          pos,
          pos + node.nodeSize,
          nameOf(id) === undefined
            ? { class: classes.missing, 'data-id': id, title: 'リンク先が見つかりません' }
            : { class: classes.link, title: 'Ctrl+クリックで開く' },
        ),
      )
    }
  })
  return DecorationSet.create(doc, out)
}

export const links = (hooks: () => Hooks) =>
  $prose(
    () =>
      new Plugin({
        key: linkKey,
        state: {
          init: (_, s) => linkMarks(s.doc, hooks()),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(linkKey) ? linkMarks(tr.doc, hooks()) : old),
        },
        props: {
          decorations: (s) => linkKey.getState(s),
          handleDOMEvents: {
            click: (view, e) => {
              const t = e.target instanceof Element ? e.target : null
              const task = t?.closest<HTMLElement>('li[data-item-type="task"]')
              if (task && t === task && e.clientX < task.getBoundingClientRect().left) {
                const pos = view.posAtDOM(task, 0) - 1
                const n = view.state.doc.nodeAt(pos)
                if (n)
                  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, checked: !n.attrs.checked }))
                return true
              }
              const mark = t?.closest('strong, em, code, del, s, a')
              if (!mark || mark.closest('pre')) return false
              if (mark instanceof HTMLAnchorElement) e.preventDefault()
              if (e.ctrlKey || e.metaKey) return mark instanceof HTMLAnchorElement
              // 端を押したときも元の書き方に戻す
              const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
              if (pos !== undefined)
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setMeta(REVEAL, true),
                )
              return true
            },
            // 押したときにカーソルが入って元の書き方に変わる前に開く
            mousedown: (_, e) => {
              if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
              const a = e.target instanceof Element ? e.target.closest('a') : null
              const id = idOfHref(a?.getAttribute('href'))
              if (!id) return false
              e.preventDefault()
              hooks().onOpenRef(id)
              return true
            },
          },
        },
      }),
  )

export interface RawLink extends At {
  from: number
  to: number
  /** 範囲の中にある patchouli: のリンク。 */
  link?: { from: number; to: number; id: string }
}

interface Raw {
  from: number
  to: number
}

const rawKey = new PluginKey<Raw | undefined>('patchouli-raw')
const isRaw = (v: unknown): v is Raw =>
  typeof v === 'object' &&
  v !== null &&
  'from' in v &&
  'to' in v &&
  typeof v.from === 'number' &&
  typeof v.to === 'number'
const REVEAL = 'patchouli-reveal'
const RAW_RE = /\[((?:\\.|[^\]\\])*)\]\(patchouli:([^)\s]+)\)/g
/** 元の書き方を見せる書式。 */
const SHOWN = new Set(['strong', 'emphasis', 'inlineCode', 'strike_through', 'link'])
/** 書き出した文の中で、カーソルの位置を探すための文字。 */
const CARET = '\uE000'

export const escapeLabel = (s: string) => s.replace(/[\\[\]]/g, '\\$&')

const isShown = (n: Node | null | undefined) => !!n?.isText && n.marks.some((m) => SHOWN.has(m.type.name))

const rawOf = (state: EditorState) => {
  const raw = rawKey.getState(state)
  return raw && raw.from < raw.to && raw.to <= state.doc.content.size ? raw : undefined
}

/** 選んでいる範囲が、元の書き方に戻している範囲の中にあるか。 */
export const inRaw = (state: EditorState) => {
  const raw = rawOf(state)
  return !!raw && state.selection.from >= raw.from && state.selection.to <= raw.to
}

/** pos に触れている、書式の付いた文字のひと続き。edge でなければ、両側が書式の中のときだけ。 */
function spanAt(doc: Node, pos: number, edge: boolean): Raw | undefined {
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock || parent.type.spec.code) return undefined
  const before = isShown($pos.nodeBefore)
  const after = isShown($pos.nodeAfter)
  if (edge ? !before && !after : !(before && after)) return undefined
  const start = $pos.start()
  const kids: { from: number; to: number; on: boolean }[] = []
  parent.forEach((c, off) => kids.push({ from: start + off, to: start + off + c.nodeSize, on: isShown(c) }))
  let i = kids.findIndex((k) => k.on && k.from <= pos && pos <= k.to)
  if (i < 0) return undefined
  let j = i
  while (kids[i - 1]?.on) i--
  while (kids[j + 1]?.on) j++
  const from = kids[i]?.from
  const to = kids[j]?.to
  return from === undefined || to === undefined ? undefined : { from, to }
}

/** 範囲の中の [表示名](patchouli:ID) を見つける。位置は文書の中のもの。 */
function rawMatches(doc: Node, raw: Raw) {
  const out: { from: number; to: number; source: string; id: string }[] = []
  doc.nodesBetween(raw.from, raw.to, (node, pos) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, undefined, '￼')
    for (const m of text.matchAll(RAW_RE)) {
      const from = pos + 1 + m.index
      const to = from + m[0].length
      if (to > raw.from && from < raw.to) out.push({ from, to, source: m[1] ?? '', id: m[2] ?? '' })
    }
    return false
  })
  return out
}

/** リンクの表示名を、リンク先のいまの名前にする。 */
function renamed(content: Fragment, nameOf: Hooks['nameOf']) {
  const nodes: Node[] = []
  content.forEach((n, _, i) => {
    const href = n.marks.find((m) => m.type.name === 'link')?.attrs.href
    const id = idOfHref(href)
    const name = id && nameOf(id)
    const same = (k: Node | null) => k?.marks.some((m) => m.type.name === 'link' && m.attrs.href === href)
    const alone =
      !same(i > 0 ? content.child(i - 1) : null) && !same(i + 1 < content.childCount ? content.child(i + 1) : null)
    nodes.push(name && n.isText && alone && n.text !== name ? n.type.schema.text(name, n.marks) : n)
  })
  return Fragment.from(nodes)
}

/** Markdown の文を、段落の中身として読む。段落 1 つにならないものは読まない。 */
function parseInline(ctx: Ctx, text: string, nameOf: Hooks['nameOf']) {
  const [, lead = '', body = '', tail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? []
  const schema = ctx.get(schemaCtx)
  const space = (s: string) => (s ? [schema.text(s)] : [])
  if (!body) return Fragment.from(space(text))
  const doc = ctx.get(parserCtx)(body)
  const first = doc.firstChild
  if (doc.childCount !== 1 || first?.type.name !== 'paragraph') return undefined
  const inner: Node[] = []
  renamed(first.content, nameOf).forEach((n) => inner.push(n))
  return Fragment.from([...space(lead), ...inner, ...space(tail)])
}

/** 元の書き方に戻していた範囲を、Markdown として読み直して書式に戻す。 */
function collapse(ctx: Ctx, tr: Transaction, raw: Raw, nameOf: Hooks['nameOf']) {
  if (raw.from >= raw.to || raw.to > tr.doc.content.size) return tr
  const blocks: Raw[] = []
  tr.doc.nodesBetween(raw.from, raw.to, (node, pos) => {
    if (!node.isTextblock) return true
    const from = Math.max(raw.from, pos + 1)
    const to = Math.min(raw.to, pos + 1 + node.content.size)
    if (from < to && !node.type.spec.code) blocks.push({ from, to })
    return false
  })
  for (const b of blocks.toReversed()) {
    let plain = true
    tr.doc.nodesBetween(b.from, b.to, (n) => {
      if (n.isInline && !n.isText) plain = false
    })
    if (!plain) continue
    const content = parseInline(ctx, tr.doc.textBetween(b.from, b.to), nameOf)
    if (content) tr.replaceWith(b.from, b.to, content)
  }
  return tr
}

/** 書式の付いた文字を、Markdown の書き方の文字に戻す。 */
function reveal(ctx: Ctx, tr: Transaction, s: Raw, head: number): Raw | null {
  const { schema } = tr.doc.type
  const para = schema.nodes.paragraph
  if (!para) return null
  const t = new Transform(schema.topNodeType.create(null, para.create(null, tr.doc.slice(s.from, s.to).content)))
  const pos = 1 + head - s.from
  t.insert(pos, schema.text(CARET, t.doc.resolve(pos).marks()))
  const md = ctx.get(serializerCtx)(t.doc).replace(/\n+$/, '')
  const caret = md.indexOf(CARET)
  const text = md.slice(0, caret) + md.slice(caret + 1)
  if (caret < 0 || !text || text.includes('\n')) return null
  tr.replaceWith(s.from, s.to, schema.text(text))
  tr.setSelection(TextSelection.create(tr.doc, s.from + caret))
  return { from: s.from, to: s.from + text.length }
}

/** 保存する文書。元の書き方に戻している範囲があれば、書式に戻したもの。 */
export function savedDoc(ctx: Ctx, state: EditorState, nameOf: Hooks['nameOf']) {
  const raw = rawOf(state)
  return raw ? collapse(ctx, state.tr, raw, nameOf).doc : state.doc
}

/** 元の書き方に戻している範囲の patchouli: のリンクを外して、表示名だけにする。 */
export function unlinkRaw(ctx: Ctx, view: EditorView, nameOf: Hooks['nameOf']) {
  const raw = rawOf(view.state)
  if (!raw) return
  const tr = view.state.tr
  const { schema } = tr.doc.type
  for (const m of rawMatches(tr.doc, raw).toReversed()) {
    const label = m.source || m.id
    if (label) tr.replaceWith(m.from, m.to, schema.text(label))
    else tr.delete(m.from, m.to)
  }
  const mapped = { from: tr.mapping.map(raw.from, -1), to: tr.mapping.map(raw.to, 1) }
  view.dispatch(collapse(ctx, tr, mapped, nameOf).setMeta(rawKey, null))
}

/**
 * 文字の入力。元の書き方に戻している範囲では、書式に変える規則を使わずにそのまま入れる。
 * まとめて入ってきた文字は、規則が 1 文字ずつを前提にしているので、入れてから最後の 1 文字で規則を試す。
 */
export function textInput(view: EditorView, from: number, to: number, text: string) {
  const raw = rawOf(view.state)
  const inside = !!raw && from >= raw.from && to <= raw.to
  if (!inside && text.length <= 1) return false
  view.dispatch(view.state.tr.insertText(text, from, to))
  if (!inside) runInputRules(view)
  return true
}

/** カーソルの前の 1 文字を、いま打ったものとして書式に変える規則を試す。日本語入力の確定のあとに使う。 */
export function runInputRules(view: EditorView) {
  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || !sel.empty || sel.$from.parentOffset === 0 || inRaw(view.state)) return
  const pos = sel.from
  const ch = view.state.doc.textBetween(pos - 1, pos)
  if (!ch) return
  for (const p of view.state.plugins) {
    const f = p.props.handleTextInput
    if (!('isInputRules' in p.spec) || !f) continue
    f.call(p, view, pos - 1, pos, ch, () => view.state.tr.insertText(ch, pos - 1, pos))
    return
  }
}

/** 元の書き方に戻している範囲を、ほかの操作で置き換えたときに忘れる。 */
export const forgetRaw = (tr: Transaction) => tr.setMeta(rawKey, null)

function reportRaw(view: EditorView, hooks: Hooks) {
  const raw = rawOf(view.state)
  if (!raw || !view.hasFocus()) return hooks.onRaw(undefined)
  const link = rawMatches(view.state.doc, raw)[0]
  hooks.onRaw({ ...at(view, raw.from), from: raw.from, to: raw.to, link: link && { ...link } })
}

/** カーソルのある書式の文字を、Markdown の書き方で見せる。カーソルが出たら書式に戻す。 */
export const rawMarks = (hooks: () => Hooks) =>
  $prose(
    (ctx) =>
      new Plugin<Raw | undefined>({
        key: rawKey,
        state: {
          init: () => undefined,
          apply(tr, raw) {
            const meta: unknown = tr.getMeta(rawKey)
            if (meta !== undefined) return isRaw(meta) ? meta : undefined
            if (!raw) return undefined
            const from = tr.mapping.map(raw.from, -1)
            const to = tr.mapping.map(raw.to, 1)
            return from < to ? { from, to } : undefined
          },
        },
        appendTransaction(trs, _old, state) {
          if (trs.some((t) => t.getMeta(rawKey) !== undefined)) return null
          const edge = trs.some((t) => t.getMeta(REVEAL))
          if (!edge && !trs.some((t) => t.selectionSet || t.docChanged)) return null
          if (inRaw(state)) return null
          const raw = rawOf(state)
          const tr = state.tr
          if (raw) collapse(ctx, tr, raw, hooks().nameOf)
          const s = tr.selection.empty ? spanAt(tr.doc, tr.selection.head, edge) : undefined
          const next = s ? reveal(ctx, tr, s, tr.selection.head) : null
          if (!raw && !next) return null
          return tr.setMeta(rawKey, next).setMeta('addToHistory', false)
        },
        props: {
          decorations: (s) => {
            const raw = rawOf(s)
            if (!raw) return null
            return DecorationSet.create(s.doc, [Decoration.inline(raw.from, raw.to, { class: hooks().classes.raw })])
          },
          handleDOMEvents: {
            focus: (view) => {
              reportRaw(view, hooks())
              return false
            },
            blur: () => {
              hooks().onRaw(undefined)
              return false
            },
            compositionend: (view) => {
              setTimeout(() => runInputRules(view))
              return false
            },
          },
        },
        view: () => ({
          update: (view) => reportRaw(view, hooks()),
          destroy: () => hooks().onRaw(undefined),
        }),
      }),
  )

const isDiagram = (n: Node) => n.type.name === 'code_block' && n.attrs.language === 'mermaid'

/** カーソルのある図のブロックにだけ、元の文を見せる印を付ける。 */
export const diagramEditing = (hooks: () => Hooks) =>
  $prose(
    () =>
      new Plugin({
        props: {
          decorations: (s) => {
            const { $head } = s.selection
            const n = $head.parent
            if (!isDiagram(n) || $head.depth === 0) return null
            const from = $head.before()
            return DecorationSet.create(s.doc, [
              Decoration.node(from, from + n.nodeSize, { class: hooks().classes.editing }),
            ])
          },
        },
      }),
  )

let pele: Promise<typeof import('pele/lazy')> | undefined

export const codeBlocks = (hooks: () => Hooks) =>
  $view(codeBlockSchema.node, () => (initial, view, getPos): NodeView => {
    let node = initial
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    pre.append(code)
    const setLanguage = (l: unknown) => {
      if (typeof l === 'string' && l) pre.dataset.language = l
      else delete pre.dataset.language
    }
    setLanguage(node.attrs.language)
    if (!isDiagram(node))
      return {
        dom: pre,
        contentDOM: code,
        update: (n) => {
          if (n.type !== node.type || isDiagram(n)) return false
          node = n
          setLanguage(n.attrs.language)
          return true
        },
      }

    const dom = document.createElement('div')
    dom.className = hooks().classes.diagram
    const shown = document.createElement('div')
    shown.contentEditable = 'false'
    dom.append(pre, shown)
    let mounted: Mounted | undefined
    let gone = false
    let loading = false
    const draw = () => {
      const src = node.textContent
      if (!src.trim()) {
        mounted?.destroy()
        mounted = undefined
        shown.replaceChildren()
        return
      }
      if (mounted) {
        if (mounted.source !== src) mounted.update(src)
        return
      }
      if (loading) return
      loading = true
      void (pele ??= import('pele/lazy'))
        .then((p) => p.mountAsync(shown, src))
        .then((m) => {
          loading = false
          if (gone) return m.destroy()
          mounted = m
          if (m.source !== node.textContent) draw()
        })
    }
    draw()
    // 図を押したら、元の文の終わりにカーソルを置く
    shown.addEventListener('mousedown', (e) => {
      const pos = getPos()
      if (pos === undefined) return
      e.preventDefault()
      const end = pos + 1 + node.content.size
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
      view.focus()
    })
    return {
      dom,
      contentDOM: code,
      update: (n) => {
        if (n.type !== node.type || !isDiagram(n)) return false
        node = n
        draw()
        return true
      },
      stopEvent: (e) => e.target instanceof globalThis.Node && shown.contains(e.target),
      ignoreMutation: (m) => m.type !== 'selection' && shown.contains(m.target),
      destroy: () => {
        gone = true
        mounted?.destroy()
      },
    }
  })

const text = (cls: string, s: string) => {
  const el = document.createElement('span')
  el.className = cls
  el.textContent = s
  return el
}

export const embeds = (hooks: () => Hooks) =>
  $view(imageSchema.node, () => (node): NodeView => {
    const { classes, nameOf, embedOf } = hooks()
    const dom = document.createElement('span')
    dom.className = classes.embed
    const id = idOfHref(node.attrs.src)
    const label = String(node.attrs.alt || '')
    const put = (el: HTMLElement) => dom.replaceChildren(el)
    if (!id) {
      const img = document.createElement('img')
      img.src = String(node.attrs.src)
      img.alt = label
      put(img)
    } else if (nameOf(id) === undefined) {
      const el = text(classes.missing, label || id)
      el.dataset.id = id
      el.title = '埋め込む素材が見つかりません'
      put(el)
    } else {
      put(text(classes.card, nameOf(id) ?? label))
      void embedOf(id).then((e) => {
        if (!e) return
        if (e.kind === 'card') {
          const card = text(classes.card, nameOf(id) ?? label)
          if (e.thumb) {
            const img = document.createElement('img')
            img.src = e.thumb
            img.alt = ''
            card.prepend(img)
          }
          put(card)
          return
        }
        const el = document.createElement(e.kind === 'image' ? 'img' : e.kind)
        el.setAttribute('src', e.src)
        if (el instanceof HTMLImageElement) el.alt = nameOf(id) ?? label
        else if (el instanceof HTMLMediaElement) {
          el.controls = true
          el.preload = 'metadata'
        }
        put(el)
      })
    }
    return {
      dom,
      ignoreMutation: () => true,
      stopEvent: (e) => e.target instanceof HTMLMediaElement,
    }
  })
