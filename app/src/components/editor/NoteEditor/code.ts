import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { type MathClasses, blockEnd, updateMath } from './math'

/** 描くコードブロック 1 つ。source は、囲みの ``` の行を除いた中身。 */
export interface CodeBlock {
  readonly lang: string
  readonly source: string
  /** 中身を書き換える。 */
  setSource: (source: string) => void
}

export interface CodeMounted {
  /** 中身が変わったとき。書かなければ、destroy を呼んでから mount し直す。 */
  update?: (block: CodeBlock) => void
  destroy?: () => void
}

/** コードブロックの言語 1 つの描き方。 */
export interface CodeView {
  mount: (el: HTMLElement, block: CodeBlock) => CodeMounted | void
  /** 描いたものの中で操作できる。押してもコードの編集に入らず、編集に入るボタンを添える。 */
  interactive?: boolean
  /** 描く要素に付けるクラス。 */
  class?: string
}

export interface CodeClasses {
  view: string
  edit: string
}

/** 囲みの ``` の行と、中身の範囲。中身がなければ from が to を越える。 */
export function fenceOf(state: EditorState, n: SyntaxNode) {
  const first = state.doc.lineAt(n.from)
  const last = state.doc.lineAt(Math.max(n.from, n.to - 1))
  const close = n.lastChild?.name === 'CodeMark' && n.lastChild.from > first.to
  return { first, last, close, body: { from: first.to + 1, to: close ? last.from - 1 : last.to } }
}

function fenceAt(state: EditorState, pos: number) {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const)
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) if (n.name === 'FencedCode') return n
  return undefined
}

/** pos のコードブロックの中身を source にする。 */
function setBody(view: EditorView, pos: number, source: string) {
  const n = fenceAt(view.state, pos)
  if (!n) return
  const { first, last, body } = fenceOf(view.state, n)
  const has = last.number > first.number && body.from <= body.to
  const from = has ? body.from : first.to
  const to = has ? body.to : first.to
  const insert = has ? source : `\n${source}`
  if (view.state.sliceDoc(from, to) !== insert) view.dispatch({ changes: { from, to, insert } })
}

interface Drawn {
  view: CodeView
  block: { lang: string; source: string; setSource: (s: string) => void }
  el: HTMLElement
  mounted?: CodeMounted
}

const drawn = new WeakMap<HTMLElement, Drawn>()

const mountIn = (d: Drawn) => {
  try {
    d.mounted = d.view.mount(d.el, d.block) ?? undefined
  } catch (e) {
    console.warn('コードブロックを描けない', e)
  }
}

const unmount = (d: Drawn) => {
  try {
    d.mounted?.destroy?.()
  } catch (e) {
    console.warn('コードブロックの表示を閉じられない', e)
  }
  d.mounted = undefined
}

export class CodeWidget extends WidgetType {
  readonly view: CodeView
  readonly lang: string
  readonly src: string
  readonly classes: CodeClasses

  constructor(view: CodeView, lang: string, src: string, classes: CodeClasses) {
    super()
    this.view = view
    this.lang = lang
    this.src = src
    this.classes = classes
  }

  eq(o: CodeWidget) {
    return (
      o.view === this.view &&
      o.lang === this.lang &&
      o.src === this.src &&
      o.classes.view === this.classes.view &&
      o.classes.edit === this.classes.edit
    )
  }

  toDOM(ev: EditorView) {
    const dom = document.createElement('div')
    dom.className = [this.classes.view, this.view.class ?? ''].join(' ')
    const toCode = (e: Event) => {
      e.preventDefault()
      ev.dispatch({ selection: { anchor: blockEnd(ev.state, ev.posAtDOM(dom)) } })
      ev.focus()
    }
    let el = dom
    if (this.view.interactive) {
      el = document.createElement('div')
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = this.classes.edit
      edit.textContent = 'コードを編集'
      edit.addEventListener('mousedown', toCode)
      edit.addEventListener('click', toCode)
      dom.append(el, edit)
    } else dom.addEventListener('mousedown', toCode)
    const block = {
      lang: this.lang,
      source: this.src,
      setSource: (s: string) => {
        if (dom.isConnected) setBody(ev, ev.posAtDOM(dom), s)
      },
    }
    const d: Drawn = { view: this.view, block, el }
    drawn.set(dom, d)
    mountIn(d)
    return dom
  }

  updateDOM(dom: HTMLElement) {
    const d = drawn.get(dom)
    if (!d || d.view !== this.view || d.block.lang !== this.lang) return false
    if (d.block.source === this.src) return true
    d.block.source = this.src
    if (d.mounted?.update) d.mounted.update(d.block)
    else {
      unmount(d)
      d.el.replaceChildren()
      mountIn(d)
    }
    return true
  }

  destroy(dom: HTMLElement) {
    const d = drawn.get(dom)
    if (d) unmount(d)
  }

  ignoreEvent() {
    return true
  }
}

/** math のコードブロック。$$…$$ と同じく、行を立てる数式として描く。 */
export function mathView(classes: MathClasses): CodeView {
  return {
    class: classes.block,
    mount(el, block) {
      updateMath(el, block.source.trim(), true, classes)
      return { update: (b) => updateMath(el, b.source.trim(), true, classes) }
    },
  }
}
