import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { SlashAction } from './commands'
import { emptyTable, focusTableAt } from './table'

/** 選んだ文字を記号で囲む。囲まれていれば外す。 */
export function toggleWrap(view: EditorView, m: string) {
  const { state } = view
  const { from, to } = state.selection.main
  const n = m.length
  if (state.sliceDoc(from - n, from) === m && state.sliceDoc(to, to + n) === m) {
    view.dispatch({
      changes: [
        { from: from - n, to: from },
        { from: to, to: to + n },
      ],
      selection: { anchor: from - n, head: to - n },
    })
    return true
  }
  const text = state.sliceDoc(from, to)
  if (text.length >= n * 2 && text.startsWith(m) && text.endsWith(m)) {
    view.dispatch({
      changes: { from, to, insert: text.slice(n, -n) },
      selection: { anchor: from, head: to - n * 2 },
    })
    return true
  }
  view.dispatch({
    changes: [
      { from, insert: m },
      { from: to, insert: m },
    ],
    selection: { anchor: from + n, head: to + n },
  })
  return true
}

const PREFIX = /^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/

/** カーソルの行の頭の記号を置き換える。 */
function setPrefix(view: EditorView, prefix: string) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = PREFIX.exec(line.text)
  const from = line.from + (m?.[1]?.length ?? 0)
  const to = line.from + (m?.[0].length ?? 0)
  view.dispatch({ changes: { from, to, insert: prefix }, selection: { anchor: line.to - (to - from) + prefix.length } })
}

/** カーソルの行が空ならそこに、空でなければ次の段落としてブロックを入れる。caret はブロックの中のカーソルの位置。 */
function insertBlock(view: EditorView, text: string, caret: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const empty = !line.text.trim()
  const from = empty ? line.from : line.to
  const head = empty ? '' : '\n\n'
  const next = view.state.sliceDoc(line.to, line.to + 1)
  const tail = next === '\n' || line.to === view.state.doc.length ? '' : '\n'
  view.dispatch({
    changes: { from, to: empty ? line.to : from, insert: head + text + tail },
    selection: { anchor: from + head.length + caret },
    scrollIntoView: true,
  })
  return from + head.length
}

export function runSlash(view: EditorView, a: SlashAction) {
  switch (a.type) {
    case 'heading':
      return setPrefix(view, `${'#'.repeat(a.level)} `)
    case 'bullets':
      return setPrefix(view, '- ')
    case 'numbers':
      return setPrefix(view, '1. ')
    case 'tasks':
      return setPrefix(view, '- [ ] ')
    case 'quote':
      return setPrefix(view, '> ')
    case 'code':
      insertBlock(view, '```\n\n```', 4)
      return undefined
    case 'diagram':
      insertBlock(view, '```mermaid\n\n```', 11)
      return undefined
    case 'rule':
      insertBlock(view, '---\n', 4)
      return undefined
    case 'table': {
      const t = emptyTable(3, 2)
      const at = insertBlock(view, t, t.length)
      focusTableAt(at)
      return undefined
    }
    default:
      return undefined
  }
}

/** pos を含むリンクを外して、表示名だけにする。 */
export function unlinkAt(view: EditorView, from: number, to: number) {
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(from, 1); n; n = n.parent) {
    if (n.name !== 'Link' || n.from > from || n.to < to) continue
    const marks = n.getChildren('LinkMark')
    const open = marks[0]
    const close = marks[1]
    if (!open || !close) return false
    const label = view.state.sliceDoc(open.to, close.from)
    view.dispatch({ changes: { from: n.from, to: n.to, insert: label } })
    return true
  }
  return false
}
