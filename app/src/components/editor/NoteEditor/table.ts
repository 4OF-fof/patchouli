import { WidgetType, type EditorView } from '@codemirror/view'

type Align = 'left' | 'center' | 'right' | undefined

interface Model {
  align: Align[]
  /** 0 行目が見出しの行。 */
  rows: string[][]
}

export interface TableHooks {
  classes: { table: string; scroll: string; tools: string; cell: string; editing: string }
  /** セルの Markdown を、表示する要素にする。 */
  render: (src: string) => Node
}

function splitRow(line: string) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

const alignOf = (s: string): Align =>
  /^:-+:$/.test(s) ? 'center' : /^:-+$/.test(s) ? 'left' : /^-+:$/.test(s) ? 'right' : undefined

function parse(text: string): Model {
  const [head = '', delim = '', ...body] = text.split('\n')
  const rows = [splitRow(head), ...body.map(splitRow)]
  const width = rows[0]?.length ?? 1
  const align = splitRow(delim).map(alignOf).slice(0, width)
  return {
    align: Array.from({ length: width }, (_, i) => align[i]),
    rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
  }
}

const escapeCell = (s: string) => s.replace(/\n/g, ' ').replace(/\\?\|/g, (m) => (m.length === 2 ? m : '\\|'))
const rowText = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`
const delimText = (a: Align) => (a === 'center' ? ':---:' : a === 'left' ? ':---' : a === 'right' ? '---:' : '---')

function serialize(m: Model) {
  const [head = [], ...body] = m.rows
  return [rowText(head), `| ${m.align.map(delimText).join(' | ')} |`, ...body.map(rowText)].join('\n')
}

export const emptyTable = (cols: number, rows: number) =>
  serialize({
    align: Array.from({ length: cols }, () => undefined),
    rows: Array.from({ length: rows + 1 }, () => Array.from({ length: cols }, () => '')),
  })

const live = new Map<HTMLElement, TableView>()

/** 表の始まりの位置で、表のセルの編集に入る。 */
export function enterTable(view: EditorView, from: number, row: 'first' | 'last') {
  for (const [dom, t] of live) {
    if (!dom.isConnected || t.view !== view || view.posAtDOM(dom) !== from) continue
    t.edit(row === 'first' ? 0 : t.model.rows.length - 1, 0)
    return true
  }
  return false
}

let pending: number | undefined

/** 次に描かれる、この位置の表の最初のセルを編集する。 */
export const focusTableAt = (from: number) => (pending = from)

class TableView {
  readonly view: EditorView
  readonly hooks: TableHooks
  text: string
  dom = document.createElement('div')
  model: Model
  editing: { r: number; c: number; input: HTMLInputElement } | undefined
  private tools = document.createElement('div')

  constructor(view: EditorView, text: string, hooks: TableHooks) {
    this.view = view
    this.text = text
    this.hooks = hooks
    this.model = parse(text)
    this.dom.className = hooks.classes.table
    this.tools.className = hooks.classes.tools
    this.tools.addEventListener('mousedown', (e) => e.preventDefault())
    const tool = (label: string, run: (r: number, c: number) => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', () => {
        const at = this.editing
        if (at) run(at.r, at.c)
      })
      this.tools.append(b)
    }
    tool('行を追加', (r, c) => this.reshape(() => this.model.rows.splice(r + 1, 0, this.blankRow()), r + 1, c))
    tool('列を追加', (r, c) =>
      this.reshape(
        () => {
          this.model.align.splice(c + 1, 0, undefined)
          for (const row of this.model.rows) row.splice(c + 1, 0, '')
        },
        r,
        c + 1,
      ),
    )
    tool('行を削除', (r, c) => {
      if (r === 0 || this.model.rows.length <= 2) return
      this.reshape(() => this.model.rows.splice(r, 1), Math.min(r, this.model.rows.length - 2), c)
    })
    tool('列を削除', (r, c) => {
      if (this.model.align.length <= 1) return
      this.reshape(
        () => {
          this.model.align.splice(c, 1)
          for (const row of this.model.rows) row.splice(c, 1)
        },
        r,
        Math.min(c, this.model.align.length - 2),
      )
    })
    this.render()
    live.set(this.dom, this)
    requestAnimationFrame(() => {
      if (pending === undefined || !this.dom.isConnected || this.view.posAtDOM(this.dom) !== pending) return
      pending = undefined
      this.edit(0, 0)
    })
  }

  private blankRow = () => this.model.align.map(() => '')

  reset(text: string) {
    this.text = text
    this.model = parse(text)
    this.editing = undefined
    this.render()
  }

  render() {
    const table = document.createElement('table')
    const { classes, render } = this.hooks
    // 数式などを描き直さないよう、中身の変わらないセルは前の描画を移して使う
    const old = new Map<string, ChildNode[][]>()
    for (const cell of this.dom.querySelectorAll<HTMLElement>('th, td')) {
      const src = cell.dataset.src
      if (src === undefined || cell.querySelector('input')) continue
      const list = old.get(src) ?? []
      list.push([...cell.childNodes])
      old.set(src, list)
    }
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement('tr')
      row.forEach((src, c) => {
        const cell = document.createElement(r === 0 ? 'th' : 'td')
        cell.className = classes.cell
        cell.dataset.src = src
        const a = this.model.align[c]
        if (a) cell.style.textAlign = a
        const prev = old.get(src)?.shift()
        if (prev) cell.append(...prev)
        else cell.append(render(src))
        cell.addEventListener('mousedown', (e) => {
          if (e.target instanceof HTMLInputElement) return
          e.preventDefault()
          this.edit(r, c)
        })
        tr.append(cell)
      })
      if (r === 0) {
        const thead = document.createElement('thead')
        thead.append(tr)
        table.append(thead)
      } else {
        let tbody = table.tBodies[0]
        if (!tbody) {
          tbody = document.createElement('tbody')
          table.append(tbody)
        }
        tbody.append(tr)
      }
    })
    const scroll = document.createElement('div')
    scroll.className = classes.scroll
    scroll.append(table)
    this.dom.replaceChildren(scroll, this.tools)
    this.tools.hidden = true
  }

  private cellAt(r: number, c: number) {
    return this.dom.querySelectorAll('tr')[r]?.children[c]
  }

  edit(r: number, c: number) {
    const rows = this.model.rows.length
    const cols = this.model.align.length
    if (r < 0 || r >= rows || c < 0 || c >= cols) return
    this.close()
    const cell = this.cellAt(r, c)
    if (!(cell instanceof HTMLElement)) return
    const input = document.createElement('input')
    input.type = 'text'
    input.spellcheck = false
    input.value = this.model.rows[r]?.[c] ?? ''
    input.setAttribute('aria-label', `${r === 0 ? '見出し' : `${r} 行目`}・${c + 1} 列目`)
    cell.classList.add(this.hooks.classes.editing)
    cell.replaceChildren(input)
    this.editing = { r, c, input }
    this.tools.hidden = false
    const take = () => {
      const row = this.model.rows[r]
      if (!row || row[c] === input.value) return
      row[c] = input.value
      this.save()
    }
    input.addEventListener('input', (e) => {
      if (!(e instanceof InputEvent) || !e.isComposing) take()
    })
    input.addEventListener('compositionend', take)
    input.addEventListener('keydown', (e) => this.key(e, r, c))
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (this.editing?.input === input) this.close()
      })
    })
    input.focus()
  }

  private close() {
    const at = this.editing
    if (!at) return
    this.editing = undefined
    const cell = at.input.parentElement
    if (cell) {
      const src = this.model.rows[at.r]?.[at.c] ?? ''
      cell.classList.remove(this.hooks.classes.editing)
      cell.dataset.src = src
      cell.replaceChildren(this.hooks.render(src))
    }
    this.tools.hidden = true
  }

  private key(e: KeyboardEvent, r: number, c: number) {
    if (e.isComposing) return
    const rows = this.model.rows.length
    const cols = this.model.align.length
    const go = (nr: number, nc: number) => {
      e.preventDefault()
      this.edit(nr, nc)
    }
    if (e.key === 'Tab') {
      const i = r * cols + c + (e.shiftKey ? -1 : 1)
      if (i < 0) return this.leave(e, -1)
      if (i >= rows * cols) return this.leave(e, 1)
      return go(Math.floor(i / cols), i % cols)
    }
    if (e.key === 'Enter') {
      if (r === rows - 1) this.reshape(() => this.model.rows.push(this.blankRow()), r + 1, c)
      else go(r + 1, c)
      e.preventDefault()
      return undefined
    }
    if (e.key === 'ArrowUp') return r === 0 ? this.leave(e, -1) : go(r - 1, c)
    if (e.key === 'ArrowDown') return r === rows - 1 ? this.leave(e, 1) : go(r + 1, c)
    if (e.key === 'Escape') return this.leave(e, 1)
    return undefined
  }

  private reshape(change: () => void, r: number, c: number) {
    change()
    this.save()
    this.render()
    this.edit(r, c)
  }

  private save() {
    const old = this.text
    const text = serialize(this.model)
    if (text === old) return
    const from = this.view.posAtDOM(this.dom)
    this.text = text
    this.view.dispatch({ changes: { from, to: from + old.length, insert: text }, userEvent: 'input.table' })
  }

  /**
   * 表の上か下の行にカーソルを移す。行がなければ作る。
   * 表のすぐ下の行に書いた文字は表の行になるので、下に出るときは空の行を 1 つ挟む。
   */
  private leave(e: Event, side: -1 | 1) {
    e.preventDefault()
    this.close()
    const { view } = this
    const { doc } = view.state
    const from = view.posAtDOM(this.dom)
    const to = from + this.text.length
    const go = (anchor: number, insert?: { at: number; text: string }) =>
      view.dispatch({
        changes: insert && { from: insert.at, insert: insert.text },
        selection: { anchor },
        scrollIntoView: true,
      })
    if (side < 0) {
      if (from > 0) go(from - 1)
      else go(0, { at: 0, text: '\n\n' })
    } else {
      const next = to < doc.length ? doc.lineAt(to + 1) : undefined
      const after = next && next.to < doc.length ? doc.lineAt(next.to + 1) : undefined
      if (next && !next.text && after && !after.text) go(after.from)
      else if (next && !next.text) go(next.to + 1, { at: next.to, text: after ? '\n\n' : '\n' })
      else go(to + 2, { at: to, text: '\n\n' })
    }
    // 先に focus すると、セルの中にあった選択範囲のまま本文に戻ってしまう
    view.focus()
  }

  destroy() {
    live.delete(this.dom)
  }
}

export class TableWidget extends WidgetType {
  readonly text: string
  readonly hooks: TableHooks

  constructor(text: string, hooks: TableHooks) {
    super()
    this.text = text
    this.hooks = hooks
  }

  eq(other: TableWidget) {
    return other.text === this.text
  }

  toDOM(view: EditorView) {
    return new TableView(view, this.text, this.hooks).dom
  }

  updateDOM(dom: HTMLElement) {
    const t = live.get(dom)
    if (!t) return false
    if (t.text !== this.text) t.reset(this.text)
    return true
  }

  destroy(dom: HTMLElement) {
    live.get(dom)?.destroy()
  }

  ignoreEvent() {
    return true
  }
}
