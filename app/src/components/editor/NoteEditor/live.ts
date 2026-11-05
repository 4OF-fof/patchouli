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
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { GFM, parser as markdownParser } from '@lezer/markdown'
import type { Mounted } from 'pele/lazy'
import { targetOf } from '../../../model/library'
import { MathSyntax, MathView, blockEnd, mathElement, mathSource } from './math'
import { TableWidget, enterTable } from './table'

export const idOfHref = (href: unknown) => (typeof href === 'string' ? targetOf(href)?.id : undefined)

export const escapeLabel = (s: string) => s.replace(/[\\[\]]/g, '\\$&')

/** Ctrl+クリックで開ける外の URL。 */
export const WEB = /^https?:\/\//i

/** 渡された要素に描き、消すときに呼ぶ関数を返す */
type Draw = (el: HTMLElement) => () => void

export type Embed =
  /** caption があれば、下に名前などを添える */
  | { kind: 'image'; src: string; caption?: Draw }
  /** error があれば、埋め込めないことを知らせるカードにする。label は名前の後ろに添える。name があれば、素材の名前の代わりに出す */
  | { kind: 'card'; thumb?: string; name?: string; label?: string; error?: string }
  /** 外のページ。画像に名前を重ね、下に site を添える */
  | { kind: 'page'; image?: string; title: string; site: string }
  /** 中身を mount で描く。key が同じあいだは描き直さない */
  | { kind: 'mount'; key: string; mount: Draw; caption?: Draw }

export interface LiveHooks {
  nameOf: (id: string) => string | undefined
  embedOf: (id: string) => Promise<Embed | undefined>
  /** URL を埋め込んだときの表示。image は、まだ画像として読んでいないか。undefined なら画像として出す */
  urlEmbedOf?: (url: string, image: boolean) => Promise<Embed | undefined>
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
  /** 埋め込みの大きさ（%）。 */
  scale: number
  label: { from: number; to: number }
  url: { from: number; to: number }
}

const refOf = (state: EditorState, n: SyntaxNode): Ref | undefined => {
  const marks = n.getChildren('LinkMark')
  const url = n.getChild('URL')
  const open = marks[0]
  const close = marks[1]
  if (!url || !open || !close) return undefined
  const href = state.sliceDoc(url.from, url.to)
  const t = targetOf(href)
  return {
    kind: n.name === 'Image' ? 'embed' : 'link',
    from: n.from,
    to: n.to,
    href,
    id: t?.id,
    scale: t?.scale ?? 100,
    label: { from: open.to, to: close.from },
    url: { from: url.from, to: url.to },
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

/** pos がコードブロックの中か。side は、境目でどちら側を見るか。 */
export function inCodeBlock(state: EditorState, pos: number, side: -1 | 1) {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent)
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true
  return false
}

const setFocus = StateEffect.define<boolean>()
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.find((e) => e.is(setFocus))?.value ?? v,
})

/** 名前や素材が変わったときに、リンクと埋め込みの見た目を作り直す。 */
export const refresh = StateEffect.define()

/** 埋め込みを Markdown の書き方のまま見せて直す。カーソルが範囲を出たら戻す。 */
export const editEmbed = StateEffect.define<{ from: number; to: number }>()
const rawField = StateField.define<{ from: number; to: number } | undefined>({
  create: () => undefined,
  update(v, tr) {
    const set = tr.effects.find((e) => e.is(editEmbed))
    if (set) return set.value
    if (!v) return v
    const from = tr.changes.mapPos(v.from, -1)
    const to = tr.changes.mapPos(v.to, 1)
    const { head } = tr.state.selection.main
    return head < from || head > to ? undefined : { from, to }
  },
})

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

/** 埋め込みの読み込み。読み終えたら done にし、描き直すときはそのまま value を使う。 */
interface Loaded {
  promise: Promise<Embed | undefined>
  done: boolean
  value?: Embed
}
/** エディタごとに持つ、読み込んだ埋め込み。 */
type Embeds = Map<string, Loaded>

const loadedOf = (embeds: Embeds, key: string, load: () => Promise<Embed | undefined>) => {
  const had = embeds.get(key)
  if (had) return had
  const l: Loaded = { promise: load(), done: false }
  void l.promise.then(
    (e) => {
      l.done = true
      l.value = e
    },
    () => {
      l.done = true
    },
  )
  embeds.set(key, l)
  return l
}

/**
 * 埋め込みの高さが変わったら次に描く前に測り直させる。CodeMirror は埋め込みの中の変化に気づくのが遅い。
 * その間は見ている行が押し出されたまま描かれ、測ったときに戻ってガタつく。
 */
const remeasure = (view: EditorView) => view.requestMeasure()

/** 埋め込みに描いた中身と、mount で描いたものを消す関数。 */
const drawn = new WeakMap<HTMLElement, { sig: string; off: (() => void)[] }>()
/** 片付けた埋め込み。あとから読み終えたものを描かない。 */
const destroyed = new WeakSet<HTMLElement>()

const unmount = (dom: HTMLElement) => {
  for (const off of drawn.get(dom)?.off ?? []) {
    try {
      off()
    } catch (e) {
      console.warn('埋め込みを閉じられない', e)
    }
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
  scale: number
  version: number
  /** カーソルが接しているか。 */
  selected: boolean
  embeds: Embeds
}

/** 画像のもとの大きさを、ふだんの大きさを CSS で決めるために渡す。 */
const imageOf = (src: string, alt: string, view: EditorView) => {
  const img = document.createElement('img')
  const natural = () => {
    if (!img.naturalWidth || !img.naturalHeight) return
    img.style.setProperty('--natural-width', `${img.naturalWidth}px`)
    img.style.setProperty('--natural-ratio', String(img.naturalWidth / img.naturalHeight))
  }
  img.addEventListener('load', () => {
    natural()
    remeasure(view)
  })
  img.src = src
  img.alt = alt
  // 一度読んだ画像は大きさがすぐ分かるので、その場で大きさを決める
  natural()
  return img
}

const scaleTo = (dom: HTMLElement, scale: number) => {
  dom.dataset.scaled = String(scale !== 100)
  dom.style.setProperty('--embed-scale', String(scale / 100))
}

class EmbedView extends WidgetType {
  readonly id: string | undefined
  readonly src: string
  readonly alt: string
  readonly name: string | undefined
  readonly scale: number
  readonly version: number
  readonly selected: boolean
  readonly embeds: Embeds
  readonly hooks: LiveHooks

  constructor(spec: EmbedSpec, hooks: LiveHooks) {
    super()
    this.id = spec.id
    this.src = spec.src
    this.alt = spec.alt
    this.name = spec.name
    this.scale = spec.scale
    this.version = spec.version
    this.selected = spec.selected
    this.embeds = spec.embeds
    this.hooks = hooks
  }

  private same(o: EmbedView) {
    return o.id === this.id && (!!this.id || o.src === this.src) && o.alt === this.alt && o.name === this.name
  }

  eq(o: EmbedView) {
    return this.same(o) && o.selected === this.selected && o.scale === this.scale && o.version === this.version
  }

  /**
   * 同じリンク先なら作り直さない。ライブラリが変わったとき（ノートを保存するたびに変わる）は中身を確かめ直し、
   * 変わっていたときだけ描き直す。作り直すと読み込み直す間に高さが変わり、本文がずれる。
   */
  updateDOM(dom: HTMLElement, view: EditorView, from: this) {
    if (!this.same(from)) return false
    dom.dataset.selected = String(this.selected)
    scaleTo(dom, this.scale)
    if (from.version !== this.version) this.load(dom, view)
    return true
  }

  toDOM(view: EditorView) {
    const { classes } = this.hooks
    const { id, name } = this
    const dom = document.createElement('span')
    dom.className = classes.embed ?? ''
    dom.dataset.selected = String(this.selected)
    scaleTo(dom, this.scale)
    if (!id) {
      if (WEB.test(this.src)) dom.dataset.page = this.src
      // 画像として読めなかった URL はすぐカードを描く
      const card = this.embeds.get(this.urlKey(false))
      if (card?.value) {
        this.put(dom, view, card, this.alt || this.src)
        return dom
      }
      const img = imageOf(this.src, this.alt, view)
      img.addEventListener('error', () => this.loadUrl(dom, view, false), { once: true })
      dom.append(img)
      this.loadUrl(dom, view, true)
      return dom
    }
    dom.dataset.ref = id
    if (name === undefined) {
      dom.append(spanOf(classes.missing, this.alt || id))
      return dom
    }
    dom.append(spanOf(classes.card, name))
    this.load(dom, view)
    return dom
  }

  private load(dom: HTMLElement, view: EditorView) {
    const { embedOf } = this.hooks
    const { id, name } = this
    if (!id || name === undefined) return
    this.put(
      dom,
      view,
      loadedOf(this.embeds, `${this.version}:${id}`, () => embedOf(id)),
      name,
    )
  }

  /** URL の埋め込み。画像として読む前に links のプラグインが受け持つか確かめ、読めなかったらカードにする。 */
  private loadUrl(dom: HTMLElement, view: EditorView, image: boolean) {
    const of = this.hooks.urlEmbedOf
    if (!of) return
    const l = loadedOf(this.embeds, this.urlKey(image), () => of(this.src, image))
    this.put(dom, view, l, this.alt || this.src)
  }

  private urlKey(image: boolean) {
    return `url:${image}:${this.src}`
  }

  /**
   * 読み終えていればその場で描く。画面の外から戻ってきたときに名前のカードを挟むと CodeMirror がカードの高さを測ってしまい、
   * 中身に替わったところで本文がずれる。
   */
  private put(dom: HTMLElement, view: EditorView, l: Loaded, name: string) {
    const fill = (e: Embed | undefined) => {
      if (e && !destroyed.has(dom) && this.show(dom, view, e, name) && dom.isConnected) remeasure(view)
    }
    if (l.done) fill(l.value)
    else void l.promise.then((e) => dom.isConnected && fill(e))
  }

  /** 中身を描く。同じ中身を描いてあれば false を返す。 */
  private show(dom: HTMLElement, view: EditorView, e: Embed, name: string) {
    const { classes } = this.hooks
    const sig = e.kind === 'mount' ? `mount:${e.key}` : JSON.stringify(e)
    if (drawn.get(dom)?.sig === sig) return false
    unmount(dom)
    delete dom.dataset.wide
    const off: (() => void)[] = []
    drawn.set(dom, { sig, off })
    const caption = (put: Draw | undefined) => {
      if (!put) return
      const el = spanOf(classes.caption, '')
      dom.append(el)
      off.push(put(el))
    }
    if (e.kind === 'mount') {
      const box = document.createElement('span')
      box.className = classes.mounted ?? ''
      dom.dataset.wide = 'true'
      dom.replaceChildren(box)
      off.push(e.mount(box))
      caption(e.caption)
      return true
    }
    if (e.kind === 'card') {
      const card = spanOf(e.error ? `${classes.card} ${classes.cardError}` : classes.card, e.name ?? name)
      if (e.thumb) {
        const img = document.createElement('img')
        img.src = e.thumb
        img.alt = ''
        card.prepend(img)
      }
      if (e.label) card.append(spanOf(classes.cardLabel, e.label))
      if (e.error) card.append(spanOf(classes.cardNote, e.error))
      dom.replaceChildren(card)
      return true
    }
    if (e.kind === 'page') {
      const cover = spanOf(classes.pageCover, '')
      cover.append(spanOf(classes.pageTitle, e.title))
      if (e.image) {
        const img = document.createElement('img')
        img.src = e.image
        img.alt = ''
        img.addEventListener('error', () => {
          img.remove()
          delete cover.dataset.image
          remeasure(view)
        })
        cover.dataset.image = 'true'
        cover.prepend(img)
      }
      const card = spanOf(classes.page, '')
      card.append(cover, spanOf(classes.pageSite, e.site))
      dom.dataset.wide = 'true'
      dom.replaceChildren(card)
      return true
    }
    dom.replaceChildren(imageOf(e.src, name, view))
    caption(e.caption)
    return true
  }

  destroy(dom: HTMLElement) {
    destroyed.add(dom)
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
      const pos = blockEnd(view.state, view.posAtDOM(dom))
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

const cellParser = markdownParser.configure([GFM, MathSyntax])
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'MathMark', 'URL'])

/** 書式の記号に挟まれたところ。 */
const inside = (n: SyntaxNode, mark: string) => {
  const m = n.getChildren(mark)
  return { from: m[0]?.to ?? n.from, to: m.length > 1 ? (m.at(-1)?.from ?? n.to) : n.to }
}

/** 表のセルの Markdown を、書式を付けた要素にする。1 つのセルだけの表として読み、見出しやリストにはしない。 */
function inline(src: string, h: LiveHooks): Node {
  const frag = document.createDocumentFragment()
  const doc = `|${src}|
|-|`
  const cell = cellParser.parse(doc).topNode.getChild('Table')?.getChild('TableHeader')?.getChild('TableCell')
  if (!cell) {
    frag.append(src)
    return frag
  }
  const c = h.classes
  const mathClasses = { inline: c.math ?? '', block: c.mathBlock ?? '', error: c.mathError ?? '' }
  const text = (from: number, to: number) => doc.slice(from, to)
  /** from から to のうち、子の要素のないところは文字のまま入れる。 */
  const fill = (into: Node, n: SyntaxNode, from: number, to: number) => {
    let at = from
    for (let k = n.firstChild; k; k = k.nextSibling) {
      if (k.to <= from || k.from >= to || MARKS.has(k.name)) continue
      if (k.from > at) into.appendChild(document.createTextNode(text(at, k.from)))
      into.appendChild(node(k))
      at = k.to
    }
    if (at < to) into.appendChild(document.createTextNode(text(at, to)))
  }
  const wrap = (tag: string, cls: string | undefined, n: SyntaxNode, mark: string) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    const r = inside(n, mark)
    fill(el, n, r.from, r.to)
    return el
  }
  const node = (n: SyntaxNode): Node => {
    switch (n.name) {
      case 'StrongEmphasis':
        return wrap('strong', c.strong, n, 'EmphasisMark')
      case 'Emphasis':
        return wrap('em', c.em, n, 'EmphasisMark')
      case 'Strikethrough':
        return wrap('del', c.del, n, 'StrikethroughMark')
      case 'InlineCode': {
        const el = document.createElement('code')
        el.className = c.code ?? ''
        const r = inside(n, 'CodeMark')
        el.textContent = text(r.from, r.to)
        return el
      }
      case 'InlineMath': {
        const r = inside(n, 'MathMark')
        return mathElement(text(r.from, r.to).replace(/\\\|/g, '|').trim(), false, mathClasses)
      }
      case 'Escape':
        return document.createTextNode(text(n.from + 1, n.to))
      case 'Link':
      case 'Image': {
        const url = n.getChild('URL')
        const m = n.getChildren('LinkMark')
        if (!url || m.length < 2) return document.createTextNode(text(n.from, n.to))
        const href = text(url.from, url.to)
        const label = text(m[0]?.to ?? n.from, m[1]?.from ?? n.from).replace(/\\(.)/g, '$1')
        const id = idOfHref(href)
        const el = document.createElement('span')
        el.className = (id ? (h.nameOf(id) === undefined ? c.missing : c.link) : c.extLink) ?? ''
        el.textContent = n.name === 'Image' ? label || (id && h.nameOf(id)) || href : label
        if (id) el.dataset.ref = id
        else if (WEB.test(href)) el.dataset.href = href
        return el
      }
      default:
        return document.createTextNode(text(n.from, n.to))
    }
  }
  fill(frag, cell, cell.from, cell.to)
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

/**
 * 装飾は打つたびに作り直すので、長いノートでは見えている範囲の前後 AROUND 文字だけを作る。
 * WHOLE 文字までのノートは、いつも全体を作る。
 */
const WHOLE = 100_000
const AROUND = 30_000

interface Span {
  from: number
  to: number
}

const setSpan = StateEffect.define<Span>()
const spanField = StateField.define<Span>({
  create: (s) => ({ from: 0, to: Math.min(s.doc.length, AROUND * 2) }),
  update: (w, tr) =>
    tr.effects.find((e) => e.is(setSpan))?.value ??
    (tr.docChanged ? { from: tr.changes.mapPos(w.from), to: tr.changes.mapPos(w.to, 1) } : w),
})

/** 見えている範囲が装飾した範囲の端に近づいたら、範囲を移す。 */
const followViewport = ViewPlugin.define((view) => {
  let queued = false
  let gone = false
  const move = () => {
    queued = false
    const len = view.state.doc.length
    if (gone || len <= WHOLE) return
    const w = view.state.field(spanField)
    const { from, to } = view.viewport
    const pad = AROUND / 3
    if ((w.from === 0 || from >= w.from + pad) && (w.to >= len || to <= w.to - pad)) return
    view.dispatch({ effects: setSpan.of({ from: Math.max(0, from - AROUND), to: Math.min(len, to + AROUND) }) })
  }
  const check = () => {
    if (queued) return
    queued = true
    queueMicrotask(move)
  }
  check()
  return {
    update: (u) => {
      if (u.viewportChanged || u.docChanged) check()
    },
    destroy: () => {
      gone = true
    },
  }
})

function build(state: EditorState, h: LiveHooks, version: number, embeds: Embeds): Built {
  const span = state.doc.length <= WHOLE ? { from: 0, to: state.doc.length } : state.field(spanField)
  const spanFrom = state.doc.lineAt(Math.min(span.from, state.doc.length)).from
  const spanTo = state.doc.lineAt(Math.min(span.to, state.doc.length)).to
  const tree = ensureSyntaxTree(state, spanTo, 100) ?? syntaxTree(state)
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
  const mathClasses = { inline: cls('math'), block: cls('mathBlock'), error: cls('mathError') }
  const codeLines = (top: number, bottom: number) => {
    for (let i = top; i <= bottom; i++) {
      const l = state.doc.line(i)
      const edge = [i === top ? cls('codeTop') : '', i === bottom ? cls('codeBottom') : '']
      out.push(Decoration.line({ class: [cls('codeLine'), ...edge].join(' ') }).range(l.from))
    }
  }

  tree.iterate({
    from: spanFrom,
    to: spanTo,
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
          const attrs: Record<string, string> = r.id
            ? { 'data-ref': r.id }
            : WEB.test(r.href)
              ? { 'data-href': r.href }
              : {}
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
          const raw = state.field(rawField, false)
          if (selected && raw && raw.from <= n.from && raw.to >= n.to) {
            mark('raw', n.from, n.to)
            return undefined
          }
          const widget = new EmbedView(
            { id: r.id, src: r.href, alt, name, scale: r.scale, version, selected, embeds },
            h,
          )
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
          if (n.parent?.name !== 'Link' && n.parent?.name !== 'Image') {
            const href = state.sliceDoc(n.from, n.to)
            mark('extLink', n.from, n.to, WEB.test(href) ? { 'data-href': href } : undefined)
          }
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
          const src = body.from <= body.to ? state.sliceDoc(body.from, body.to) : ''
          const widget =
            lang === 'mermaid'
              ? new Diagram(src, cls('diagram'))
              : lang === 'math'
                ? new MathView(src.trim(), true, mathClasses)
                : undefined
          if (widget) {
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
          codeLines(top, bottom)
          return false
        }
        case 'BlockMath': {
          const first = lineOf(n.from)
          const last = lastLine(n)
          const widget = new MathView(mathSource(state, n), true, mathClasses)
          if (!near(first.from, last.to)) {
            out.push(Decoration.replace({ widget, block: true }).range(first.from, last.to))
            return false
          }
          out.push(Decoration.widget({ widget, block: true, side: 1 }).range(last.to))
          for (const m of n.getChildren('MathMark')) mark('mark', m.from, m.to)
          codeLines(first.number, last.number)
          return false
        }
        case 'InlineMath':
          if (near(n.from, n.to)) {
            for (const m of n.getChildren('MathMark')) mark('mark', m.from, m.to)
            mark('code', n.from, n.to)
          } else
            out.push(
              Decoration.replace({ widget: new MathView(mathSource(state, n), false, mathClasses) }).range(
                n.from,
                n.to,
              ),
            )
          return false
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

/** 表のすぐ上の行から、表の最初のセルの編集に入る。Enter は、空の行にいるときだけ入る。 */
const tableBelow = (blank: boolean) => (view: EditorView) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const { doc } = view.state
  const line = doc.lineAt(sel.head)
  if (line.number >= doc.lines || (blank && line.text.trim())) return false
  const next = doc.line(line.number + 1)
  const n = syntaxTree(view.state).resolveInner(next.from, 1)
  for (let t: SyntaxNode | null = n; t; t = t.parent) {
    if (t.name === 'Table') return t.from >= next.from && enterTable(view, next.from, 'first')
  }
  return false
}

/** カーソルのない書式は記号を隠し、カーソルのある書式だけ Markdown の書き方を見せる。 */
export function live(hooks: () => LiveHooks): Extension {
  let version = 0
  const embeds: Embeds = new Map()
  const field = StateField.define<Built>({
    create: (s) => build(s, hooks(), version, embeds),
    update(built, tr) {
      if (tr.effects.some((e) => e.is(refresh))) {
        const old = `${version}:`
        for (const k of embeds.keys()) if (k.startsWith(old)) embeds.delete(k)
        version++
      }
      if (tr.docChanged || tr.selection || tr.effects.length) return build(tr.state, hooks(), version, embeds)
      return built
    },
    provide: (f) => [
      EditorView.decorations.from(f, (b) => b.deco),
      EditorView.atomicRanges.of((v) => v.state.field(f).atoms),
    ],
  })
  return [
    ViewPlugin.define(() => ({ destroy: () => embeds.clear() })),
    focusField,
    EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
    spanField,
    followViewport,
    rawField,
    field,
    skipLead,
    Prec.high(
      keymap.of([
        { key: 'ArrowDown', run: intoTable(true) },
        { key: 'ArrowUp', run: intoTable(false) },
        { key: 'Tab', run: tableBelow(false) },
        { key: 'Enter', run: tableBelow(true) },
        { key: 'Home', run: lineEdge(false, false), shift: lineEdge(false, true) },
        { key: 'End', run: lineEdge(true, false), shift: lineEdge(true, true) },
      ]),
    ),
  ]
}
