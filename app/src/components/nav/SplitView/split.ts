/** 分割の木。葉はタブの id。row は左右に、col は上下に並べる。sizes は parts と同じ数で、足すと 1。 */
export type SplitNode = { tab: number } | { dir: 'row' | 'col'; parts: SplitNode[]; sizes: number[] }

export type SplitSide = 'right' | 'down'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 左上から右下への並び。 */
export const leaves = (n: SplitNode): number[] => ('tab' in n ? [n.tab] : n.parts.flatMap(leaves))

const normal = (sizes: number[]) => {
  const sum = sizes.reduce((a, b) => a + b, 0)
  return sizes.map((s) => s / sum)
}

/** target の右か下に id を置く。同じ向きに並んでいるところなら、その並びに足す。 */
export function insertBeside(n: SplitNode, target: number, id: number, side: SplitSide): SplitNode {
  const dir = side === 'right' ? 'row' : 'col'
  if ('tab' in n) return n.tab === target ? { dir, parts: [n, { tab: id }], sizes: [0.5, 0.5] } : n
  const at = n.parts.findIndex((p) => 'tab' in p && p.tab === target)
  if (at >= 0 && n.dir === dir) {
    const half = (n.sizes[at] ?? 0) / 2
    return {
      dir,
      parts: n.parts.toSpliced(at + 1, 0, { tab: id }),
      sizes: n.sizes.toSpliced(at, 1, half, half),
    }
  }
  return { ...n, parts: n.parts.map((p) => insertBeside(p, target, id, side)) }
}

/** id を除く。1 つだけになった並びは、その中身に置き換える。 */
export function removeLeaf(n: SplitNode, id: number): SplitNode | undefined {
  if ('tab' in n) return n.tab === id ? undefined : n
  const kept = n.parts.map((p, i) => ({ p: removeLeaf(p, id), s: n.sizes[i] ?? 0 })).filter((x) => x.p)
  const [only] = kept
  if (!only) return undefined
  if (kept.length === 1) return only.p
  return { dir: n.dir, parts: kept.flatMap((x) => x.p ?? []), sizes: normal(kept.map((x) => x.s)) }
}

/** まとまりの並びから id を除く。ペインが 1 つだけになったまとまりは、なくす。 */
export const withoutLeaf = (groups: SplitNode[], id: number) =>
  groups.flatMap((n) => {
    const m = removeLeaf(n, id)
    return m && !('tab' in m) ? [m] : []
  })

/** 葉ごとの場所。全体を 1 とした割合で返す。 */
export function rectsOf(n: SplitNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<number, Rect>()) {
  if ('tab' in n) return out.set(n.tab, r)
  let at = 0
  n.parts.forEach((p, i) => {
    const s = n.sizes[i] ?? 0
    rectsOf(
      p,
      n.dir === 'row'
        ? { x: r.x + r.w * at, y: r.y, w: r.w * s, h: r.h }
        : { x: r.x, y: r.y + r.h * at, w: r.w, h: r.h * s },
      out,
    )
    at += s
  })
  return out
}

/** 並びの中の境目。path は根からたどる parts の番号で、i の後ろが境目。 */
export interface Seam {
  path: number[]
  i: number
  dir: 'row' | 'col'
  /** 境目の位置（x か y）と、並び全体の場所。 */
  at: number
  box: Rect
}

export function seamsOf(n: SplitNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }, path: number[] = []): Seam[] {
  if ('tab' in n) return []
  const out: Seam[] = []
  let at = 0
  n.parts.forEach((p, i) => {
    const s = n.sizes[i] ?? 0
    const box =
      n.dir === 'row'
        ? { x: r.x + r.w * at, y: r.y, w: r.w * s, h: r.h }
        : { x: r.x, y: r.y + r.h * at, w: r.w, h: r.h * s }
    out.push(...seamsOf(p, box, [...path, i]))
    at += s
    if (i < n.parts.length - 1)
      out.push({ path, i, dir: n.dir, at: n.dir === 'row' ? r.x + r.w * at : r.y + r.h * at, box: r })
  })
  return out
}

/** path の並びの sizes を差し替える。 */
export function withSizes(n: SplitNode, path: number[], sizes: number[]): SplitNode {
  if ('tab' in n) return n
  const [head, ...rest] = path
  if (head === undefined) return { ...n, sizes }
  return { ...n, parts: n.parts.map((p, i) => (i === head ? withSizes(p, rest, sizes) : p)) }
}

export function sizesAt(n: SplitNode, path: number[]): number[] {
  if ('tab' in n) return []
  const [head, ...rest] = path
  if (head === undefined) return n.sizes
  const p = n.parts[head]
  return p ? sizesAt(p, rest) : []
}

/** ファイルから読んだ木を、index からタブを引いて組み直す。引けない葉は除く。 */
export function parseSplit(v: unknown, tabOf: (index: number) => number | undefined): SplitNode | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const x: Record<string, unknown> = Object.fromEntries(Object.entries(v))
  if (typeof x.tab === 'number') {
    const id = tabOf(x.tab)
    return id === undefined ? undefined : { tab: id }
  }
  if ((x.dir !== 'row' && x.dir !== 'col') || !Array.isArray(x.parts)) return undefined
  const sizes = Array.isArray(x.sizes) ? x.sizes : []
  const kept = x.parts.flatMap((p, i) => {
    const node = parseSplit(p, tabOf)
    const s = sizes[i]
    return node ? [{ node, s: typeof s === 'number' && s > 0 ? s : 1 }] : []
  })
  const [only] = kept
  if (!only) return undefined
  if (kept.length === 1) return only.node
  return { dir: x.dir, parts: kept.map((k) => k.node), sizes: normal(kept.map((k) => k.s)) }
}

/** ファイルに書く形。葉をタブの並びの index にする。 */
export function savedSplit(n: SplitNode, indexOf: (id: number) => number): unknown {
  return 'tab' in n
    ? { tab: indexOf(n.tab) }
    : { dir: n.dir, parts: n.parts.map((p) => savedSplit(p, indexOf)), sizes: n.sizes }
}

export type PaneDir = 'left' | 'right' | 'up' | 'down'

const EPS = 1e-6

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)

/** id のペインと、dir の向きに接しているペイン。接しているものが複数あれば、いちばん広く接しているもの。 */
export function neighborOf(rects: Map<number, Rect>, id: number, dir: PaneDir): number | undefined {
  const r = rects.get(id)
  if (!r) return undefined
  let best: number | undefined
  let most = EPS
  for (const [other, c] of rects) {
    if (other === id) continue
    const touch =
      dir === 'right'
        ? Math.abs(c.x - (r.x + r.w)) < EPS
        : dir === 'left'
          ? Math.abs(c.x + c.w - r.x) < EPS
          : dir === 'down'
            ? Math.abs(c.y - (r.y + r.h)) < EPS
            : Math.abs(c.y + c.h - r.y) < EPS
    if (!touch) continue
    const o =
      dir === 'left' || dir === 'right'
        ? overlap(c.y, c.y + c.h, r.y, r.y + r.h)
        : overlap(c.x, c.x + c.w, r.x, r.x + r.w)
    if (o > most) {
      most = o
      best = other
    }
  }
  return best
}

/** a と b のペインの場所を入れ替える。 */
export function swapLeaves(n: SplitNode, a: number, b: number): SplitNode {
  if ('tab' in n) return n.tab === a ? { tab: b } : n.tab === b ? { tab: a } : n
  return { ...n, parts: n.parts.map((p) => swapLeaves(p, a, b)) }
}
