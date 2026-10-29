import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { SyntaxNode } from '@lezer/common'
import type { Line, MarkdownConfig } from '@lezer/markdown'

const DOLLAR = 36
const BACKSLASH = 92
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === -1
const isDigit = (c: number) => c >= 48 && c <= 57

/** depth は型に出ていないが、コードブロックと同じく、引用や箇条書きを抜けたかをこれで見る。 */
const depthOf = (line: Line) => ('depth' in line && typeof line.depth === 'number' ? line.depth : 0)

const opensBlock = (line: Line) =>
  line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR && line.indent - line.baseIndent < 4

/** pos の $ で始まる $…$ の終わり（閉じの $ の次）。数式でなければ -1。 */
export function inlineMathEnd(char: (i: number) => number, pos: number, end: number) {
  // 開きの $ のすぐ後ろが空白なら、値段などの $ として扱う
  if (char(pos) !== DOLLAR || char(pos + 1) === DOLLAR || isSpace(char(pos + 1))) return -1
  for (let i = pos + 1; i < end; i++) {
    const c = char(i)
    if (c === BACKSLASH) {
      i++
      continue
    }
    if (c !== DOLLAR || isSpace(char(i - 1))) continue
    return isDigit(char(i + 1)) ? -1 : i + 1
  }
  return -1
}

/** GitHub と同じく、文中の $…$ と、行を立てる $$…$$ を数式として読む。 */
export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath' },
    { name: 'BlockMath', block: true },
    { name: 'MathMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1
        const end = inlineMathEnd((i) => cx.char(i), pos, cx.end)
        if (end < 0) return -1
        return cx.addElement(
          cx.elt('InlineMath', pos, end, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', end - 1, end)]),
        )
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx, line) {
        if (!opensBlock(line)) return false
        const from = cx.lineStart + line.pos
        const marks = [cx.elt('MathMark', from, from + 2)]
        const rest = line.text.slice(line.pos + 2).trimEnd()
        if (rest.length >= 2 && rest.endsWith('$$')) {
          const end = from + 2 + rest.length
          marks.push(cx.elt('MathMark', end - 2, end))
          cx.nextLine()
          cx.addElement(cx.elt('BlockMath', from, end, marks))
          return true
        }
        while (cx.nextLine() && depthOf(line) >= cx.depth) {
          const text = line.text.slice(line.pos).trimEnd()
          if (!text.endsWith('$$')) continue
          const end = cx.lineStart + line.pos + text.length
          marks.push(cx.elt('MathMark', end - 2, end))
          cx.nextLine()
          break
        }
        cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), marks))
        return true
      },
      endLeaf: (_cx, line) => opensBlock(line),
    },
  ],
}

/** InlineMath と BlockMath の中の TeX。 */
export function mathSource(state: EditorState, n: SyntaxNode) {
  const marks = n.getChildren('MathMark')
  const open = marks[0]
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined
  return state.sliceDoc(open?.to ?? n.from, close?.from ?? n.to).trim()
}

/** 行を立てる数式やコードブロックで、描いたものを押したときにカーソルを置く所（中身の終わり）。 */
export function blockEnd(state: EditorState, pos: number) {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    const first = state.doc.lineAt(n.from)
    if (n.name === 'FencedCode') {
      const close = n.lastChild?.name === 'CodeMark' ? n.lastChild : null
      return close && close.from > first.to ? close.from - 1 : n.to
    }
    if (n.name === 'BlockMath') {
      const marks = n.getChildren('MathMark')
      const close = marks.length > 1 ? marks[marks.length - 1] : undefined
      if (!close) return n.to
      const l = state.doc.lineAt(close.from)
      return l.number > first.number && !state.sliceDoc(l.from, close.from).trim() ? l.from - 1 : close.from
    }
  }
  return pos
}

type Katex = typeof import('katex').default
let katex: Katex | undefined
let loading: Promise<Katex> | undefined

const loadKatex = () =>
  (loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => {
    katex = k.default
    return katex
  }))

function render(dom: HTMLElement, src: string, display: boolean, errorClass: string) {
  const k = katex
  if (!k) {
    void loadKatex().then(() => {
      if (dom.dataset.src === src) render(dom, src, display, errorClass)
    })
    return
  }
  dom.classList.remove(errorClass)
  dom.removeAttribute('title')
  if (!src) {
    dom.replaceChildren()
    return
  }
  try {
    k.render(src, dom, { displayMode: display, throwOnError: true })
  } catch (e) {
    dom.classList.add(errorClass)
    dom.title = e instanceof Error ? e.message : String(e)
    dom.textContent = src
  }
}

export interface MathClasses {
  inline: string
  block: string
  error: string
}

export function mathElement(src: string, display: boolean, classes: MathClasses) {
  const dom = document.createElement(display ? 'div' : 'span')
  dom.className = display ? classes.block : classes.inline
  dom.dataset.src = src
  render(dom, src, display, classes.error)
  return dom
}

export class MathView extends WidgetType {
  readonly src: string
  readonly display: boolean
  readonly classes: MathClasses

  constructor(src: string, display: boolean, classes: MathClasses) {
    super()
    this.src = src
    this.display = display
    this.classes = classes
  }

  eq(o: MathView) {
    const a = o.classes
    const b = this.classes
    return (
      o.src === this.src &&
      o.display === this.display &&
      a.inline === b.inline &&
      a.block === b.block &&
      a.error === b.error
    )
  }

  toDOM(view: EditorView) {
    const dom = mathElement(this.src, this.display, this.classes)
    dom.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const at = view.posAtDOM(dom)
      view.dispatch({ selection: { anchor: this.display ? blockEnd(view.state, at) : at + 1 } })
      view.focus()
    })
    return dom
  }

  updateDOM(dom: HTMLElement) {
    if (dom.tagName !== (this.display ? 'DIV' : 'SPAN')) return false
    if (dom.dataset.src === this.src) return true
    dom.dataset.src = this.src
    render(dom, this.src, this.display, this.classes.error)
    return true
  }

  ignoreEvent() {
    return true
  }
}
