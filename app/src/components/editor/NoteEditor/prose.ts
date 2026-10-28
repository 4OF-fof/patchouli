import { codeBlockSchema, imageSchema, linkSchema } from '@milkdown/kit/preset/commonmark'
import type { Mounted } from 'pele/lazy'
import type { Node } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
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
                !sel.empty && sel instanceof TextSelection && view.hasFocus()
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
              const a = t?.closest('a')
              if (!a) return false
              e.preventDefault()
              if (e.ctrlKey || e.metaKey) return true
              // 端を押したときも元の書き方に戻す
              const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
              if (pos !== undefined && idOfHref(a.getAttribute('href')))
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
  id?: string
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
const escapeLabel = (s: string) => s.replace(/[\\[\]]/g, '\\$&')
const unescapeLabel = (s: string) => s.replace(/\\([!-/:-@[-`{-~])/g, '$1')

interface Span {
  from: number
  to: number
  href: string
  text: string
}

/** pos を含むリンクの範囲。edge なら端も含める。 */
function linkAt(doc: Node, pos: number, edge: boolean): Span | undefined {
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock || parent.type.spec.code) return undefined
  const inside = (s: Span) => (edge ? s.from <= pos && pos <= s.to : s.from < pos && pos < s.to)
  const start = $pos.start()
  let cur: Span | undefined
  let found: Span | undefined
  parent.forEach((child, offset) => {
    if (found) return
    const mark = child.marks.find((m) => m.type.name === 'link' && idOfHref(m.attrs.href))
    const href = child.isText && mark ? String(mark.attrs.href) : undefined
    const from = start + offset
    if (href && cur?.href === href && cur.to === from) {
      cur.to += child.nodeSize
      cur.text += child.text ?? ''
      return
    }
    if (cur && inside(cur)) found = cur
    cur = href ? { from, to: from + child.nodeSize, href, text: child.text ?? '' } : undefined
  })
  if (!found && cur && inside(cur)) found = cur
  return found
}

/** 範囲の中の [表示名](patchouli:ID) を見つける。位置は文書の中のもの。 */
function rawMatches(doc: Node, raw: Raw) {
  const out: { from: number; to: number; label: string; id: string }[] = []
  if (raw.from >= raw.to || raw.to > doc.content.size) return out
  doc.nodesBetween(raw.from, raw.to, (node, pos) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, undefined, '￼')
    for (const m of text.matchAll(RAW_RE)) {
      const from = pos + 1 + m.index
      const to = from + m[0].length
      if (to > raw.from && from < raw.to) out.push({ from, to, label: unescapeLabel(m[1] ?? ''), id: m[2] ?? '' })
    }
    return false
  })
  return out
}

/** 元の書き方に戻していた範囲を、リンクに戻す。plain なら文字だけにする。 */
function collapse(tr: Transaction, raw: Raw, nameOf: Hooks['nameOf'], plain = false) {
  const { schema } = tr.doc.type
  for (const m of rawMatches(tr.doc, raw).toReversed()) {
    const label = nameOf(m.id) ?? (m.label || m.id)
    const marks = (tr.doc.nodeAt(m.from)?.marks ?? []).filter((x) => x.type.name !== 'link')
    const link = schema.marks.link?.create({ href: LINK_SCHEME + m.id })
    tr.replaceWith(m.from, m.to, schema.text(label, plain || !link ? marks : [...marks, link]))
  }
  return tr
}

function reveal(tr: Transaction, s: Span, head: number): Raw {
  const raw = `[${escapeLabel(s.text)}](${s.href})`
  const marks = (tr.doc.nodeAt(s.from)?.marks ?? []).filter((x) => x.type.name !== 'link')
  tr.replaceWith(s.from, s.to, tr.doc.type.schema.text(raw, marks))
  const off = Math.min(head - s.from, s.text.length)
  tr.setSelection(TextSelection.create(tr.doc, s.from + 1 + off))
  return { from: s.from, to: s.from + raw.length }
}

/** 保存する文書。元の書き方に戻している範囲があれば、リンクに戻したもの。 */
export function savedDoc(state: EditorState, nameOf: Hooks['nameOf']) {
  const raw = rawKey.getState(state)
  return raw ? collapse(state.tr, raw, nameOf).doc : state.doc
}

/** 元の書き方に戻している範囲のリンクを外して、文字だけにする。 */
export function unlinkRaw(view: EditorView, nameOf: Hooks['nameOf']) {
  const raw = rawKey.getState(view.state)
  if (!raw) return
  view.dispatch(collapse(view.state.tr, raw, nameOf, true).setMeta(rawKey, null))
}

/** 元の書き方に戻している範囲を、ほかの操作で置き換えたときに忘れる。 */
export const forgetRaw = (tr: Transaction) => tr.setMeta(rawKey, null)

function reportRaw(view: EditorView, hooks: Hooks) {
  const raw = rawKey.getState(view.state)
  if (!raw || raw.to > view.state.doc.content.size || !view.hasFocus()) return hooks.onRaw(undefined)
  const id = rawMatches(view.state.doc, raw)[0]?.id
  hooks.onRaw({ ...at(view, raw.from), from: raw.from, to: raw.to, id })
}

export const rawLinks = (hooks: () => Hooks) =>
  $prose(
    () =>
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
          const raw = rawKey.getState(state)
          const sel = state.selection
          if (raw && sel.from >= raw.from && sel.to <= raw.to) return null
          const tr = state.tr
          if (raw) collapse(tr, raw, hooks().nameOf)
          const s = tr.selection.empty ? linkAt(tr.doc, tr.selection.head, edge) : undefined
          const next = s ? reveal(tr, s, tr.selection.head) : null
          if (!raw && !next) return null
          return tr.setMeta(rawKey, next).setMeta('addToHistory', false)
        },
        props: {
          decorations: (s) => {
            const raw = rawKey.getState(s)
            if (!raw || raw.to > s.doc.content.size) return null
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
