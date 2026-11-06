/*
 * 選んだノートを真ん中に置き、リンクでつながるページを図にする画面。右クリックメニューから開く。
 * リンクは書いた側と書かれた側のどちらからもたどり、たどる段の数は 1 か 2 を選べる。ページを押すと本体で開く。
 */

import { type LibraryItem, type ScreenApi, definePlugin } from '@patchouli/plugin'

type Pos = { x: number; y: number; angle: number }

const LINK_RE = /!?\[(?:\\.|[^\]\\])*\]\(patchouli:([^)\s?]+)[^)\s]*\)/g
const DEPTH_KEY = 'depth'
const LABEL_MAX = 10
const MARGIN = 56
const MIN_ARC = 112
const SVG = 'http://www.w3.org/2000/svg'

const CSS = `
.pg-page { position: absolute; inset: 0; display: flex; flex-direction: column; }
.pg-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-8) var(--space-16); padding: var(--space-16) var(--space-20) 0; }
.pg-head h1 { margin: 0; font-size: var(--fs-heading); font-weight: 700; }
.pg-count { font-size: var(--fs-meta); color: var(--muted); }
.pg-tools { margin-left: auto; align-self: center; }
.pg-area { position: relative; flex: 1; min-height: 0; }
.pg-area svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pg-edge { stroke: var(--line-2); stroke-width: 1; }
.pg-node { cursor: pointer; outline: none; }
.pg-node circle { fill: var(--card); stroke: var(--muted); stroke-width: 1.5; }
.pg-node[data-ring="0"] circle { fill: var(--accent); stroke: var(--accent); }
.pg-node:hover circle, .pg-node:focus-visible circle { stroke: var(--accent); stroke-width: 3; }
.pg-node text { fill: var(--ink); font-size: var(--fs-meta); paint-order: stroke; stroke: var(--paper); stroke-width: 4px; }
.pg-node[data-ring="2"] text { fill: var(--muted); }
.pg-none { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: var(--fs-list); }
`

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

const short = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s)

/** ノートの ID → リンクでつながるノートの ID。書いた側と書かれた側のどちらにも入れる。 */
function linksOf(items: LibraryItem[]): Map<string, Set<string>> {
  const notes = new Set(items.filter((it) => it.note).map((it) => it.id))
  const out = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    const s = out.get(a) ?? new Set<string>()
    s.add(b)
    out.set(a, s)
  }
  for (const it of items) {
    if (!it.note) continue
    for (const m of (it.body ?? '').matchAll(LINK_RE)) {
      const to = m[1]
      if (!to || to === it.id || !notes.has(to)) continue
      add(it.id, to)
      add(to, it.id)
    }
  }
  return out
}

/** 真ん中から段ごとに並べたノート。 */
function ringsOf(center: string[], links: Map<string, Set<string>>, depth: number): string[][] {
  const seen = new Set(center)
  const out = [center]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of out[d] ?? [])
      for (const to of links.get(id) ?? [])
        if (!seen.has(to)) {
          seen.add(to)
          next.push(to)
        }
    if (!next.length) break
    out.push(next)
  }
  return out
}

/** 望む向きの順に、間を gap 以上あけて並べる。一周に収まらないときは、等しい間で回して合わせる。 */
function spread(want: number[], gap: number): number[] {
  const n = want.length
  const out = [...want]
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i] ?? 0, (out[i - 1] ?? 0) + gap)
  const shift = out.reduce((s, a, i) => s + a - (want[i] ?? 0), 0) / n
  if ((out[n - 1] ?? 0) - (out[0] ?? 0) <= 2 * Math.PI - gap) return out.map((a) => a - shift)
  const step = (2 * Math.PI) / n
  const start = Math.atan2(
    want.reduce((s, a, i) => s + Math.sin(a - i * step), 0),
    want.reduce((s, a, i) => s + Math.cos(a - i * step), 0),
  )
  return want.map((_, i) => start + i * step)
}

/** 段ごとに円の上に並べる。1 段目は等しい間で並べ、その先は線が交わりにくいよう、前の段でつながるものの向きに寄せる。 */
function layout(rings: string[][], links: Map<string, Set<string>>, w: number, h: number): Map<string, Pos> {
  const pos = new Map<string, Pos>()
  const cx = w / 2
  const cy = h / 2
  const r = Math.max(40, Math.min(w, h) / 2 - MARGIN)
  const toward = (id: string) => {
    const from = [...(links.get(id) ?? [])].flatMap((to) => pos.get(to) ?? [])
    return Math.atan2(
      from.reduce((s, p) => s + Math.sin(p.angle), 0),
      from.reduce((s, p) => s + Math.cos(p.angle), 0),
    )
  }
  rings.forEach((ring, k) => {
    const radius = k === 0 ? (ring.length > 1 ? r * 0.15 : 0) : (r * k) / (rings.length - 1)
    const even = ring.map((_, i) => (2 * Math.PI * i) / ring.length - Math.PI / 2)
    const want = k === 0 ? even : ring.map(toward)
    const order = ring.map((id, i) => ({ id, want: want[i] ?? 0 })).toSorted((a, b) => a.want - b.want)
    const angles =
      k <= 1
        ? even
        : spread(
            order.map((o) => o.want),
            Math.min((2 * Math.PI) / ring.length, MIN_ARC / radius),
          )
    order.forEach(({ id }, i) => {
      const angle = angles[i] ?? 0
      pos.set(id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), angle })
    })
  })
  return pos
}

function mount(root: HTMLElement, api: ScreenApi) {
  let depth = 2

  const page = el('div', 'pg-page')
  const head = el('header', 'pg-head')
  const title = el('h1')
  const count = el('span', 'pg-count')
  const tools = el('span', 'pg-tools')
  const select = el('select')
  select.setAttribute('aria-label', 'たどる段の数')
  for (const [value, label] of [
    ['1', '1 段まで'],
    ['2', '2 段まで'],
  ] as const) {
    const o = el('option', undefined, label)
    o.value = value
    select.append(o)
  }
  select.value = String(depth)
  tools.append(select)
  head.append(title, count, tools)
  const area = el('div', 'pg-area')
  page.append(head, area)
  root.append(el('style', undefined, CSS), page)

  const node = (it: LibraryItem, p: Pos, ring: number) => {
    const g = svg('g', { class: 'pg-node', 'data-ring': Math.min(ring, 2), tabindex: 0, role: 'link' })
    g.setAttribute('aria-label', it.name)
    const t = svg('text', { x: p.x, y: p.y - 12, 'text-anchor': 'middle' })
    t.textContent = short(it.name)
    const full = svg('title')
    full.textContent = it.name
    g.append(full, svg('circle', { cx: p.x, cy: p.y, r: ring === 0 ? 8 : 6 }), t)
    const open = (newTab: boolean) => api.open(it.id, { newTab })
    g.addEventListener('click', (e) => open(e.ctrlKey || e.metaKey))
    g.addEventListener('auxclick', (e) => e.button === 1 && open(true))
    g.addEventListener('keydown', (e) => e.key === 'Enter' && open(e.ctrlKey || e.metaKey))
    return g
  }

  const render = () => {
    const center = api.targets().filter((it) => it.note)
    const first = center[0]
    title.textContent = first
      ? `「${first.name}」${center.length > 1 ? ` ほか ${center.length - 1} 件` : ''}の関係図`
      : 'ページの関係図'
    if (!first) {
      count.textContent = ''
      area.replaceChildren(el('p', 'pg-none', 'ノートを選んで、右クリックメニューから開きます'))
      return
    }
    const links = linksOf(api.items())
    const rings = ringsOf(
      center.map((it) => it.id),
      links,
      depth,
    )
    const shown = new Set(rings.flat())
    count.textContent = `${shown.size - center.length} 件のページ`
    const pos = layout(rings, links, area.clientWidth, area.clientHeight)
    const out = svg('svg')
    for (const a of shown)
      for (const b of links.get(a) ?? []) {
        const [p, q] = [pos.get(a), pos.get(b)]
        if (a < b && p && q) out.append(svg('line', { class: 'pg-edge', x1: p.x, y1: p.y, x2: q.x, y2: q.y }))
      }
    rings.forEach((ring, k) => {
      for (const id of ring) {
        const it = api.item(id)
        const p = pos.get(id)
        if (it && p) out.append(node(it, p, k))
      }
    })
    area.replaceChildren(out)
  }

  select.addEventListener('change', () => {
    depth = select.value === '1' ? 1 : 2
    render()
    void api.setData(DEPTH_KEY, String(depth))
  })
  const resized = new ResizeObserver(() => render())
  resized.observe(area)
  const stop = api.onChange(render)
  void api.getData(DEPTH_KEY).then((v) => {
    if (v !== '1' && v !== '2') return
    depth = Number(v)
    select.value = v
    render()
  })

  return () => {
    stop()
    resized.disconnect()
  }
}

export default definePlugin({
  screens: { graph: { mount } },
})
