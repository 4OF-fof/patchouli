import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
  Prec,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { Mounted } from 'pele/lazy'
import { LINK_SCHEME } from '../../../model/library'
import { TableWidget, enterTable } from './table'

export const idOfHref = (href: unknown) =>
  typeof href === 'string' && href.startsWith(LINK_SCHEME) ? href.slice(LINK_SCHEME.length) : undefined

export const escapeLabel = (s: string) => s.replace(/[\\[\]]/g, '\\$&')

export type Embed =
  | { kind: 'image'; src: string }
  /** error があれば、埋め込めないことを知らせるカードにする */
  | { kind: 'card'; thumb?: string; error?: string }
  /** 中身を mount で描く。key が同じあいだは描き直さない。mount が返した関数は、消すときに呼ぶ */
  | { kind: 'mount'; key: string; mount: (el: HTMLElement) => () => void }

export interface LiveHooks {
  nameOf: (id: string) => string | undefined
  embedOf: (id: string) => Promise<Embed | undefined>
  onOpenRef: (id: string) => void
  classes: Record<string, string | undefined>
}

/** 本文の中のリンクか埋め込み。 */
export interface Ref {
  kind: 'link' | 'embed'
  from: number
  to: number
  href: string
  id?: string
  label: { from: number; to: number }
}

const refOf = (state: EditorState, n: SyntaxNode): Ref | undefined => {
  const marks = n.getChildren('LinkMark')
  const url = n.getChild('URL')
  const open = marks[0]
  const close = marks[1]
  if (!url || !open || !close) return undefined
  const href = state.sliceDoc(url.from, url.to)
  return {
    kind: n.name === 'Image' ? 'embed' : 'link',
    from: n.from,
    to: n.to,
    href,
    id: idOfHref(href),
    label: { from: open.to, to: close.from },
  }
}

/** pos に触れているリンクか埋め込み。 */
export function refAt(state: EditorState, pos: number): Ref | undefined {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Link' || n.name === 'Image') {
        const r = refOf(state, n)
        if (r) return r
      }
    }
  }
  return undefined
}

/** from〜to を覆っている書式の名前。 */
export function marksAt(state: EditorState, from: number, to: number) {
  const names: Record<string, string> = {
    StrongEmphasis: 'strong',
    Emphasis: 'emphasis',
    Strikethrough: 'strike',
    InlineCode: 'code',
    Link: 'link',
  }
  const out = new Set<string>()
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); n; n = n.parent) {
    const m = names[n.name]
    if (m && n.from <= from && n.to >= to) out.add(m)
  }
  return [...out]
}

const setFocus = StateEffect.define<boolean>()
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.find((e) => e.is(setFocus))?.value ?? v,
})

/** 名前や素材が変わったときに、リンクと埋め込みの見た目を作り直す。 */
export const refresh = StateEffect.define()

class Text extends WidgetType {
  readonly text: string
  readonly cls: string
  readonly attrs: Record<string, string>

  constructor(text: string, cls: string, attrs: Record<string, string> = {}) {
    super()
    this.text = text
    this.cls = cls
    this.attrs = attrs
  }

  eq(o: Text) {
    return o.text === this.text && o.cls === this.cls && JSON.stringify(o.attrs) === JSON.stringify(this.attrs)
  }

  toDOM() {
    const el = document.createElement('span')
    el.className = this.cls
    el.textContent = this.text
    for (const [k, v] of Object.entries(this.attrs)) el.setAttribute(k, v)
    return el
  }
}

class Rule extends WidgetType {
  readonly cls: string

  constructor(cls: string) {
    super()
    this.cls = cls
  }

  eq(o: Rule) {
    return o.cls === this.cls
  }

  toDOM() {
    const el = document.createElement('span')
    el.className = this.cls
    return el
  }
}

class Check extends WidgetType {
  readonly checked: boolean
  readonly cls: string

  constructor(checked: boolean, cls: string) {
    super()
    this.checked = checked
    this.cls = cls
  }

  eq(o: Check) {
    return o.checked === this.checked && o.cls === this.cls
  }

  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = this.cls
    el.setAttribute('role', 'checkbox')
    el.setAttribute('aria-checked', String(this.checked))
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(el)
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return el
  }

  ignoreEvent() {
    return true
  }
}

const embeds = new Map<string, Promise<Embed | undefined>>()
/** 埋め込みに描いた中身と、mount で描いたものを消す関数。 */
const drawn = new WeakMap<HTMLElement, { sig: string; off?: () => void }>()

const unmount = (dom: HTMLElement) => {
  try {
    drawn.get(dom)?.off?.()
  } catch (e) {
    console.warn('埋め込みを閉じられない', e)
  }
  drawn.delete(dom)
}

const spanOf = (cls: string | undefined, s: string) => {
  const el = document.createElement('span')
  el.className = cls ?? ''
  el.textContent = s
  return el
}

interface EmbedSpec {
  id: string | undefined
  src: string
  alt: string
  name: string | undefined
  version: number
  /** カーソルが接しているか。 */
  selected: boolean
}

class EmbedView extends WidgetType {
  readonly id: string | undefined
  readonly src: string
  readonly alt: string
  readonly name: string | undefined
  readonly version: number
  readonly selected: boolean
  readonly hooks: LiveHooks

  constructor(spec: EmbedSpec, hooks: LiveHooks) {
    super()
    this.id = spec.id
    this.src = spec.src
    this.alt = spec.alt
    this.name = spec.name
    this.version = spec.version
    this.selected = spec.selected
    this.hooks = hooks
  }

  private same(o: EmbedView) {
    return o.id === this.id && o.src === this.src && o.alt === this.alt && o.name === this.name
  }

  eq(o: EmbedView) {
    return this.same(o) && o.selected === this.selected && o.version === this.version
  }

  /**
   * 同じリンク先なら作り直さない。ライブラリが変わったとき（ノートを保存するたびに変わる）は中身を確かめ直し、
   * 変わっていたときだけ描き直す。作り直すと読み込み直す間に高さが変わり、本文がずれる。
   */
  updateDOM(dom: HTMLElement, _view: EditorView, from: this) {
    if (!this.same(from)) return false
    dom.dataset.selected = String(this.selected)
    if (from.version !== this.version) this.load(dom)
    return true
  }

  toDOM() {
    const { classes } = this.hooks
    const { id, name } = this
    const dom = document.createElement('span')
    dom.className = classes.embed ?? ''
    dom.dataset.selected = String(this.selected)
    if (!id) {
      const img = document.createElement('img')
      img.src = this.src
      img.alt = this.alt
      dom.append(img)
      return dom
    }
    dom.dataset.ref = id
    if (name === undefined) {
      dom.append(spanOf(classes.missing, this.alt || id))
      return dom
    }
    dom.append(spanOf(classes.card, name))
    this.load(dom)
    return dom
  }

  private load(dom: HTMLElement) {
    const { classes, embedOf } = this.hooks
    const { id, name } = this
    if (!id || name === undefined) return
    const key = `${this.version}:${id}`
    let p = embeds.get(key)
    if (!p) {
      p = embedOf(id)
      embeds.set(key, p)
    }
    void p.then((e) => {
      if (!e) return
      const sig = e.kind === 'mount' ? `mount:${e.key}` : JSON.stringify(e)
      if (drawn.get(dom)?.sig === sig) return
      unmount(dom)
      delete dom.dataset.wide
      if (e.kind === 'mount') {
        const box = document.createElement('span')
        box.className = classes.mounted ?? ''
        dom.dataset.wide = 'true'
        dom.replaceChildren(box)
        drawn.set(dom, { sig, off: e.mount(box) })
        return
      }
      drawn.set(dom, { sig })
      if (e.kind === 'card') {
        const card = spanOf(e.error ? `${classes.card} ${classes.cardError}` : classes.card, name)
        if (e.thumb) {
          const img = document.createElement('img')
          img.src = e.thumb
          img.alt = ''
          card.prepend(img)
        }
        if (e.error) card.append(spanOf(classes.cardNote, e.error))
        dom.replaceChildren(card)
        return
      }
      const img = document.createElement('img')
      img.src = e.src
      img.alt = name
      dom.replaceChildren(img)
    })
  }

  destroy(dom: HTMLElement) {
    unmount(dom)
  }

  ignoreEvent(e: Event) {
    return e.target instanceof Element && !!e.target.closest(`.${this.hooks.classes.mounted}`)
  }
}

let pele: Promise<typeof import('pele/lazy')> | undefined
const diagrams = new WeakMap<HTMLElement, { src: string; mounted?: Mounted; loading?: boolean; gone?: boolean }>()

function draw(dom: HTMLElement) {
  const s = diagrams.get(dom)
  if (!s) return
  if (!s.src.trim()) {
    s.mounted?.destroy()
    s.mounted = undefined
    dom.replaceChildren()
    return
  }
  if (s.mounted) {
    if (s.mounted.source !== s.src) s.mounted.update(s.src)
    return
  }
  if (s.loading) return
  s.loading = true
  const src = s.src
  void (pele ??= import('pele/lazy'))
    .then((p) => p.mountAsync(dom, src))
    .then((m) => {
      s.loading = false
      if (s.gone) return m.destroy()
      s.mounted = m
      if (m.source !== s.src) draw(dom)
      return undefined
    })
}

/** 図のブロックの元の文の終わり。 */
function codeEnd(state: EditorState, pos: number) {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== 'FencedCode') continue
    const close = n.lastChild?.name === 'CodeMark' ? n.lastChild : null
    const first = state.doc.lineAt(n.from)
    return close && close.from > first.to ? close.from - 1 : n.to
  }
  return pos
}

class Diagram extends WidgetType {
  readonly src: string
  readonly cls: string

  constructor(src: string, cls: string) {
    super()
    this.src = src
    this.cls = cls
  }

  eq(o: Diagram) {
    return o.src === this.src && o.cls === this.cls
  }

  toDOM(view: EditorView) {
    const dom = document.createElement('div')
    dom.className = this.cls
    diagrams.set(dom, { src: this.src })
    draw(dom)
    dom.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = codeEnd(view.state, view.posAtDOM(dom))
      view.dispatch({ selection: { anchor: pos } })
      view.focus()
    })
    return dom
  }

  updateDOM(dom: HTMLElement) {
    const s = diagrams.get(dom)
    if (!s) return false
    s.src = this.src
    draw(dom)
    return true
  }

  destroy(dom: HTMLElement) {
    const s = diagrams.get(dom)
    if (!s) return
    s.gone = true
    s.mounted?.destroy()
  }

  ignoreEvent() {
    return true
  }
}

/** 表のセルの Markdown を、書式を付けた要素にする。 */
function inline(src: string, h: LiveHooks): Node {
  const frag = document.createDocumentFragment()
  const re =
    /`([^`]+)`|!?\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*|_(.+?)_|\\([!-/:-@[-`{-~])/g
  let at = 0
  const c = h.classes
  const wrap = (tag: string, cls: string | undefined, inner: string) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    el.append(inline(inner, h))
    return el
  }
  for (const m of src.matchAll(re)) {
    if (m.index > at) frag.append(src.slice(at, m.index))
    at = m.index + m[0].length
    const [all, code, label, href, s1, s2, del, e1, e2, esc] = m
    if (code !== undefined) {
      const el = document.createElement('code')
      el.className = c.code ?? ''
      el.textContent = code
      frag.append(el)
    } else if (href !== undefined) {
      const id = idOfHref(href)
      const text = (label ?? '').replace(/\\(.)/g, '$1')
      const el = document.createElement('span')
      el.className = (id ? (h.nameOf(id) === undefined ? c.missing : c.link) : c.extLink) ?? ''
      el.textContent = all.startsWith('!') ? text || (id && h.nameOf(id)) || href : text
      if (id) el.dataset.ref = id
      frag.append(el)
    } else if (s1 !== undefined || s2 !== undefined) frag.append(wrap('strong', c.strong, s1 ?? s2 ?? ''))
    else if (del !== undefined) frag.append(wrap('del', c.del, del))
    else if (e1 !== undefined || e2 !== undefined) frag.append(wrap('em', c.em, e1 ?? e2 ?? ''))
    else if (esc !== undefined) frag.append(esc)
  }
  if (at < src.length) frag.append(src.slice(at))
  return frag
}

const HEADING = /^ATXHeading(\d)$/
const INLINE: Record<string, [cls: string, mark: string]> = {
  Emphasis: ['em', 'EmphasisMark'],
  StrongEmphasis: ['strong', 'EmphasisMark'],
  Strikethrough: ['del', 'StrikethroughMark'],
  InlineCode: ['code', 'CodeMark'],
}

interface Built {
  deco: DecorationSet
  /** カーソルや削除で、ひとまとまりに扱う範囲（埋め込み）。 */
  atoms: DecorationSet
}

function build(state: EditorState, h: LiveHooks, version: number): Built {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)
  const focused = state.field(focusField)
  const { ranges } = state.selection
  const near = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from)
  const lineOf = (pos: number) => state.doc.lineAt(pos)
  const onLine = (pos: number) => {
    const l = lineOf(pos)
    return near(l.from, l.to)
  }
  /** ブロックの終わりの行。終わりが次の行の頭にかかっていても、中身の最後の行にする。 */
  const lastLine = (n: SyntaxNode) => lineOf(Math.max(n.from, n.to - 1))
  const c = h.classes
  const cls = (name: string) => c[name] ?? ''
  const out: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  /** 箇条書きの行の頭と、その深さ。 */
  const depth = new Map<number, number>()
  const hide = (from: number, to: number) => {
    if (from < to) out.push(Decoration.replace({}).range(from, to))
  }
  const mark = (name: string, from: number, to: number, attributes?: Record<string, string>) => {
    if (from < to) out.push(Decoration.mark({ class: cls(name), attributes }).range(from, to))
  }
  /** 行の頭の、カーソルが来ても戻さない印。 */
  const lineMark = (from: number, to: number, widget: WidgetType = new Text('', cls('lineMark'))) => {
    if (from < to) out.push(Decoration.replace({ widget }).range(from, to))
  }
  const line = (name: string, pos: number) => out.push(Decoration.line({ class: cls(name) }).range(lineOf(pos).from))
  const spaceAfter = (to: number) => (state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to)
  const tableHooks = {
    classes: {
      table: cls('table'),
      scroll: cls('tableScroll'),
      tools: cls('tableTools'),
      cell: cls('cell'),
      editing: cls('cellEditing'),
    },
    render: (src: string) => inline(src, h),
  }

  tree.iterate({
    enter: (ref) => {
      const n = ref.node
      const heading = HEADING.exec(n.name)
      if (heading) {
        line(`h${heading[1]}`, n.from)
        const show = onLine(n.from)
        for (const m of n.getChildren('HeaderMark')) {
          if (show) mark('mark', m.from, m.to)
          else if (!state.sliceDoc(lineOf(m.from).from, m.from).trim()) hide(m.from, spaceAfter(m.to))
          else {
            let s = m.from
            while (s > n.from && state.sliceDoc(s - 1, s) === ' ') s--
            hide(s, m.to)
          }
        }
        return undefined
      }
      const inl = INLINE[n.name]
      if (inl) {
        mark(inl[0], n.from, n.to)
        const show = near(n.from, n.to)
        for (const m of n.getChildren(inl[1])) {
          if (show) mark('mark', m.from, m.to)
          else hide(m.from, m.to)
        }
        return undefined
      }
      switch (n.name) {
        case 'SetextHeading1':
        case 'SetextHeading2': {
          line(n.name === 'SetextHeading1' ? 'h1' : 'h2', n.from)
          const m = n.getChild('HeaderMark')
          if (m && !near(n.from, n.to)) {
            const l = lineOf(m.from)
            out.push(Decoration.replace({ block: true }).range(l.from, l.to))
          } else if (m) mark('mark', m.from, m.to)
          return undefined
        }
        case 'Link': {
          const r = refOf(state, n)
          if (!r) return undefined
          const attrs: Record<string, string> = r.id ? { 'data-ref': r.id } : {}
          if (near(n.from, n.to)) {
            mark('raw', n.from, n.to, attrs)
            return undefined
          }
          const kind = r.id ? (h.nameOf(r.id) === undefined ? 'missing' : 'link') : 'extLink'
          if (r.label.from === r.label.to) {
            const text = (r.id && h.nameOf(r.id)) || r.id || r.href
            out.push(Decoration.replace({ widget: new Text(text, cls(kind), attrs) }).range(n.from, n.to))
            return false
          }
          hide(n.from, r.label.from)
          mark(kind, r.label.from, r.label.to, attrs)
          hide(r.label.to, n.to)
          return undefined
        }
        case 'Image': {
          const r = refOf(state, n)
          if (!r) return false
          const alt = state.sliceDoc(r.label.from, r.label.to)
          const name = r.id ? h.nameOf(r.id) : undefined
          const selected = near(n.from, n.to)
          const widget = new EmbedView({ id: r.id, src: r.href, alt, name, version, selected }, h)
          out.push(Decoration.replace({ widget }).range(n.from, n.to))
          atoms.push(Decoration.mark({}).range(n.from, n.to))
          return false
        }
        case 'Escape':
          if (!near(n.from, n.to)) hide(n.from, n.from + 1)
          return undefined
        case 'Autolink': {
          const show = near(n.from, n.to)
          for (const m of n.getChildren('LinkMark')) {
            if (show) mark('mark', m.from, m.to)
            else hide(m.from, m.to)
          }
          return undefined
        }
        case 'URL':
          if (n.parent?.name !== 'Link' && n.parent?.name !== 'Image') mark('extLink', n.from, n.to)
          return undefined
        case 'ListItem': {
          let d = 0
          for (let p = n.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') d++
          for (let l = lineOf(n.from); ; l = state.doc.line(l.number + 1)) {
            depth.set(l.from, d)
            if (l.to >= lastLine(n).to) break
          }
          return undefined
        }
        case 'ListMark': {
          const item = n.parent
          const task = item?.getChild('Task')?.getChild('TaskMarker')
          const start = lineOf(n.from).from
          if (!state.sliceDoc(start, n.from).trim()) lineMark(start, n.from)
          if (task) {
            if (near(n.from, spaceAfter(task.to))) mark('mark', n.from, task.to)
            else {
              const checked = /x/i.test(state.sliceDoc(task.from, task.to))
              lineMark(n.from, task.from)
              lineMark(task.from, task.to, new Check(checked, `${cls('check')} ${cls('lineMark')}`))
            }
          } else if (item?.parent?.name === 'BulletList')
            lineMark(n.from, n.to, new Text('•', `${cls('bullet')} ${cls('lineMark')}`))
          return undefined
        }
        case 'TaskMarker':
          if (/x/i.test(state.sliceDoc(n.from, n.to))) line('done', n.from)
          return undefined
        case 'Blockquote':
          for (let l = lineOf(n.from); ; l = state.doc.line(l.number + 1)) {
            line('quote', l.from)
            if (l.to >= lastLine(n).to) break
          }
          return undefined
        case 'QuoteMark':
          lineMark(n.from, spaceAfter(n.to))
          return undefined
        case 'HorizontalRule':
          if (onLine(n.from)) mark('mark', n.from, n.to)
          else lineMark(n.from, n.to, new Rule(`${cls('hr')} ${cls('lineMark')}`))
          return false
        case 'FencedCode':
        case 'CodeBlock': {
          const first = lineOf(n.from)
          const last = lastLine(n)
          const fenced = n.name === 'FencedCode'
          const info = n.getChild('CodeInfo')
          const lang = info ? state.sliceDoc(info.from, info.to).trim() : ''
          const close = fenced && n.lastChild?.name === 'CodeMark' && n.lastChild.from > first.to
          const show = near(first.from, last.to)
          const body = { from: fenced ? first.to + 1 : first.from, to: close ? last.from - 1 : last.to }
          if (lang === 'mermaid') {
            const src = body.from <= body.to ? state.sliceDoc(body.from, body.to) : ''
            const widget = new Diagram(src, cls('diagram'))
            if (!show) {
              out.push(Decoration.replace({ widget, block: true }).range(first.from, last.to))
              return false
            }
            out.push(Decoration.widget({ widget, block: true, side: 1 }).range(last.to))
          }
          const hideFences = fenced && !show
          let top = first.number
          let bottom = last.number
          if (hideFences) {
            out.push(Decoration.replace({ block: true }).range(first.from, first.to))
            top++
            if (close) {
              out.push(Decoration.replace({ block: true }).range(last.from, last.to))
              bottom--
            }
          }
          for (let i = top; i <= bottom; i++) {
            const l = state.doc.line(i)
            const edge = [i === top ? cls('codeTop') : '', i === bottom ? cls('codeBottom') : '']
            out.push(Decoration.line({ class: [cls('codeLine'), ...edge].join(' ') }).range(l.from))
          }
          return false
        }
        case 'Table': {
          const from = lineOf(n.from).from
          const to = lastLine(n).to
          const widget = new TableWidget(state.sliceDoc(from, to), tableHooks)
          out.push(Decoration.replace({ widget, block: true }).range(from, to))
          return false
        }
        default:
          return undefined
      }
    },
  })
  for (const [from, d] of depth)
    out.push(Decoration.line({ class: cls('listLine'), attributes: { style: `--depth: ${d}` } }).range(from))
  return { deco: Decoration.set(out, true), atoms: Decoration.set(atoms, true) }
}

const PREFIX = /^\s*(?:(?:#{1,6}|>|[-*+](?:\s+\[[ xX]\])?|\d+[.)])(?:\s+|$))*/

/**
 * 行の頭と終わりへの移動。隠した記号があると見た目の端が記号の内側になり、行頭の太字の中に文字が入ってしまうので、
 * 見た目の端と同じ並びにあれば、行の頭の印（# や - など）のすぐ後ろと、行の終わりに移す。
 */
const lineEdge = (forward: boolean, extend: boolean) => (view: EditorView) => {
  const { state } = view
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  const visual = view.moveToLineBoundary(sel, forward).head
  const edge = forward ? line.to : line.from + (PREFIX.exec(line.text)?.[0].length ?? 0)
  // 隠した記号の中は位置が取れないか、高さのない位置になる。そのときは、見た目の端との間は隠した文字だけなので同じ並び
  const at = (pos: number, side?: -1 | 1) => {
    const r = view.coordsAtPos(pos, side)
    return r && r.bottom - r.top >= 1 ? r : undefined
  }
  const a = at(visual)
  const b = at(edge, forward ? -1 : 1)
  const head = !a || !b || (a.top < b.bottom && b.top < a.bottom) ? edge : visual
  view.dispatch({
    selection: extend ? { anchor: sel.anchor, head } : { anchor: head },
    scrollIntoView: true,
    userEvent: 'select',
  })
  return true
}

/** 行の頭で、いつも隠しておく印（箇条書きの字下げと点・引用の記号）の範囲。 */
function leadOf(state: EditorState, line: Line) {
  let from = -1
  let to = -1
  const spaceAfter = (pos: number) => (state.sliceDoc(pos, pos + 1) === ' ' ? pos + 1 : pos)
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (n.from > line.to) return false
      if (n.from < line.from) return undefined
      let end: number | undefined
      if (n.name === 'QuoteMark') end = spaceAfter(n.to)
      else if (n.name === 'ListMark') {
        const bullet = n.node.parent?.parent?.name === 'BulletList' && !n.node.parent.getChild('Task')
        if (from < 0 && !state.sliceDoc(line.from, n.from).trim()) from = line.from
        end = bullet ? spaceAfter(n.to) : n.from
      }
      if (end === undefined) return undefined
      if (from < 0) from = n.from
      to = Math.max(to, end)
      return undefined
    },
  })
  return from >= 0 && from < to ? { from, to } : undefined
}

/** カーソルを、隠した印の内側に置かない。印のすぐ後ろから左へ動いたときは、前の行の終わりへ移す。 */
const skipLead = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged) return tr
  const { state } = tr
  const before = tr.startState.selection.main.head
  let moved = false
  const sel = EditorSelection.create(
    tr.selection.ranges.map((r) => {
      const line = state.doc.lineAt(r.head)
      const lead = leadOf(state, line)
      if (!lead || r.head < lead.from || r.head >= lead.to) return r
      const back = before >= lead.to && before <= line.to && r.head < before && line.number > 1
      const head = back ? line.from - 1 : lead.to
      moved = true
      return r.empty ? EditorSelection.cursor(head) : EditorSelection.range(r.anchor, head)
    }),
    tr.selection.mainIndex,
  )
  return moved ? [tr, { selection: sel, sequential: true }] : tr
})

/** 上下のカーソル移動で表をまたぐときは、表のセルの編集に入る。 */
const intoTable = (forward: boolean) => (view: EditorView) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const moved = view.moveVertically(sel, forward).head
  const from = Math.min(sel.head, moved)
  const to = Math.max(sel.head, moved)
  // 下へは最初の表、上へは最後の表に入る
  let table: number | undefined
  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (n) => {
      if (n.name !== 'Table') return undefined
      const start = view.state.doc.lineAt(n.from).from
      if (forward && start > sel.head) table ??= start
      else if (!forward && n.to <= sel.head) table = start
      return false
    },
  })
  return table !== undefined && enterTable(view, table, forward ? 'first' : 'last')
}

/** カーソルのない書式は記号を隠し、カーソルのある書式だけ Markdown の書き方を見せる。 */
export function live(hooks: () => LiveHooks): Extension {
  let version = 0
  const field = StateField.define<Built>({
    create: (s) => build(s, hooks(), version),
    update(built, tr) {
      if (tr.effects.some((e) => e.is(refresh))) version++
      if (tr.docChanged || tr.selection || tr.effects.length) return build(tr.state, hooks(), version)
      return built
    },
    provide: (f) => [
      EditorView.decorations.from(f, (b) => b.deco),
      EditorView.atomicRanges.of((v) => v.state.field(f).atoms),
    ],
  })
  return [
    focusField,
    EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
    field,
    skipLead,
    Prec.high(
      keymap.of([
        { key: 'ArrowDown', run: intoTable(true) },
        { key: 'ArrowUp', run: intoTable(false) },
        { key: 'Home', run: lineEdge(false, false), shift: lineEdge(false, true) },
        { key: 'End', run: lineEdge(true, false), shift: lineEdge(true, true) },
      ]),
    ),
  ]
}
