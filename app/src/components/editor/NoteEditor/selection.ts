import { type BlockInfo, BlockType, type EditorView, RectangleMarker, layer } from '@codemirror/view'

interface Row {
  left: number
  right: number
  top: number
  bottom: number
}

const EMPTY_LINE_WIDTH = 6

function lineOf(view: EditorView, pos: number) {
  const { node } = view.domAtPos(pos)
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest<HTMLElement>('.cm-line') ?? null
}

/** 行の上下の余白を除いた範囲と、行の高さ */
function boxOf(line: HTMLElement) {
  const r = line.getBoundingClientRect()
  const s = getComputedStyle(line)
  const lh = parseFloat(s.lineHeight)
  return {
    left: r.left + parseFloat(s.paddingLeft),
    top: r.top + parseFloat(s.paddingTop),
    bottom: r.bottom - parseFloat(s.paddingBottom),
    lh: Number.isFinite(lh) ? lh : parseFloat(s.fontSize) * 1.5,
  }
}

/** 文字の矩形を見た目の行ごとにまとめ、上下を行の高さまで広げて隙間をなくす */
function rowsOf(rects: DOMRect[], box: ReturnType<typeof boxOf>) {
  const rows: Row[] = []
  for (const r of rects.toSorted((a, b) => a.top - b.top)) {
    if (r.width < 0.5 || r.height < 0.5) continue
    const last = rows.at(-1)
    if (last && r.top < last.bottom - 1 && r.bottom > last.top + 1) {
      last.left = Math.min(last.left, r.left)
      last.right = Math.max(last.right, r.right)
      last.top = Math.min(last.top, r.top)
      last.bottom = Math.max(last.bottom, r.bottom)
    } else rows.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  const half = box.lh / 2
  for (const row of rows) {
    const mid = (row.top + row.bottom) / 2
    row.top = Math.max(box.top, Math.min(row.top, mid - half))
    row.bottom = Math.min(box.bottom, Math.max(row.bottom, mid + half))
    if (row.top - box.top < half) row.top = box.top
    if (box.bottom - row.bottom < half) row.bottom = box.bottom
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (b.top - a.bottom < half) a.bottom = b.top = (a.bottom + b.top) / 2
  }
  return rows
}

function textRows(view: EditorView, block: BlockInfo, from: number, to: number): Row[] {
  const line = lineOf(view, block.from)
  if (!line) return []
  const box = boxOf(line)
  if (block.length === 0) {
    if (to <= block.from) return []
    return [{ left: box.left, right: box.left + EMPTY_LINE_WIDTH, top: box.top, bottom: box.bottom }]
  }
  const s = Math.max(from, block.from)
  const e = Math.min(to, block.to)
  if (s >= e) return []
  const start = view.domAtPos(s)
  const end = view.domAtPos(e)
  const range = document.createRange()
  try {
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
  } catch {
    return []
  }
  return rowsOf([...range.getClientRects()], box)
}

function rowsIn(view: EditorView, block: BlockInfo, from: number, to: number): Row[] {
  if (block.to < from || block.from > to) return []
  if (Array.isArray(block.type)) return block.type.flatMap((b) => rowsIn(view, b, from, to))
  if (block.type === BlockType.Text) return textRows(view, block, from, to)
  if (from > block.from || to < block.to) return []
  const content = view.contentDOM.getBoundingClientRect()
  const top = view.documentTop + block.top
  return [{ left: content.left, right: content.right, top, bottom: top + block.height }]
}

/** 選んだ範囲を、見た目の行ごとに文字に沿った矩形で描く。標準の選択の色は、文字や部品ごとに高さがそろわず形が崩れる */
export function selectionLayer(className: string) {
  return layer({
    above: false,
    markers(view) {
      const base = view.scrollDOM.getBoundingClientRect()
      const left = base.left - view.scrollDOM.scrollLeft
      const top = base.top - view.scrollDOM.scrollTop
      const out: RectangleMarker[] = []
      for (const r of view.state.selection.ranges) {
        if (r.empty || r.to < view.viewport.from || r.from > view.viewport.to) continue
        for (const block of view.viewportLineBlocks)
          for (const row of rowsIn(view, block, r.from, r.to))
            out.push(
              new RectangleMarker(
                className,
                row.left - left,
                row.top - top,
                row.right - row.left,
                row.bottom - row.top,
              ),
            )
      }
      return out
    },
    update: (u) => u.docChanged || u.selectionSet || u.viewportChanged,
  })
}
