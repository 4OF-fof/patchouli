/*
 * zip の詳細に、中身をフォルダの木で描く。目次は WASM の call（entries）が読む。
 * フォルダは開いたときに中を描くので、中身の多い zip でも開くのは速い。
 */

import { definePlugin } from '@patchouli/plugin'

interface Listed {
  entries: { path: string; size: number }[]
  packed: number
}

interface Zip {
  methods: { entries(): Listed }
}

interface Folder {
  name: string
  folders: Map<string, Folder>
  files: { name: string; size: number }[]
  size: number
  count: number
}

const CSS = `
.zp-page { padding: var(--space-16) var(--space-20); }
.zp-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-4) var(--space-12); margin-bottom: var(--space-12); }
.zp-head h1 { margin: 0; font-size: var(--fs-heading); font-weight: 700; overflow-wrap: anywhere; }
.zp-sum, .zp-size, .zp-none { color: var(--muted); font-size: var(--fs-meta); }
.zp-tree, .zp-tree ul { margin: 0; padding: 0; list-style: none; }
.zp-tree ul { padding-left: var(--space-16); }
.zp-row { display: flex; align-items: center; gap: var(--space-8); min-height: 28px; padding: 0 var(--space-8); border-radius: var(--radius-sm); }
.zp-row:hover { background: var(--overlay-hover); }
.zp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zp-size { font-variant-numeric: tabular-nums; }
.zp-tree summary { list-style: none; cursor: pointer; }
.zp-tree summary::-webkit-details-marker { display: none; }
.zp-tree summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.zp-mark { width: 12px; flex: none; color: var(--muted); transition: transform 0.12s; }
details[open] > summary .zp-mark { transform: rotate(90deg); }
.zp-file .zp-mark { visibility: hidden; }
`

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

const bytes = (n: number) => {
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${UNITS[i]}`
}

const folder = (name: string): Folder => ({ name, folders: new Map(), files: [], size: 0, count: 0 })

function treeOf(entries: Listed['entries']) {
  const root = folder('')
  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean)
    const dir = e.path.endsWith('/')
    const name = dir ? undefined : parts.pop()
    let at = root
    const up = [root]
    for (const p of parts) {
      let next = at.folders.get(p)
      if (!next) at.folders.set(p, (next = folder(p)))
      at = next
      up.push(at)
    }
    if (name === undefined) continue
    at.files.push({ name, size: e.size })
    for (const f of up) {
      f.size += e.size
      f.count++
    }
  }
  return root
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const byName = new Intl.Collator('ja', { numeric: true }).compare

function row(name: string, size: string) {
  const r = el('span', 'zp-row')
  r.append(el('span', 'zp-mark', '›'), el('span', 'zp-name', name), el('span', 'zp-size', size))
  r.title = name
  return r
}

function list(f: Folder) {
  const ul = el('ul')
  for (const sub of [...f.folders.values()].sort((a, b) => byName(a.name, b.name))) {
    const li = el('li')
    const d = el('details')
    const s = el('summary')
    s.append(row(`${sub.name}/`, sub.count ? `${sub.count} 件 · ${bytes(sub.size)}` : '空'))
    d.append(s)
    d.addEventListener('toggle', () => d.open && d.childElementCount === 1 && d.append(list(sub)))
    li.append(d)
    ul.append(li)
  }
  for (const file of f.files.sort((a, b) => byName(a.name, b.name))) {
    const li = el('li', 'zp-file')
    li.append(row(file.name, bytes(file.size)))
    ul.append(li)
  }
  return ul
}

export default definePlugin<Zip>({
  mount(root, api) {
    let alive = true
    const page = el('div', 'zp-page')
    const head = el('header', 'zp-head')
    const sum = el('span', 'zp-sum', '読み込み中…')
    head.append(el('h1', undefined, `${api.item.name}.${api.item.ext}`), sum)
    page.append(head)
    root.append(el('style', undefined, CSS), page)
    api
      .call('entries')
      .then(({ entries, packed }) => {
        if (!alive) return
        const tree = treeOf(entries)
        sum.textContent = `${tree.count} 件 · ${bytes(tree.size)}（圧縮後 ${bytes(packed)}）`
        if (!entries.length) {
          page.append(el('p', 'zp-none', '中身はありません'))
          return
        }
        const ul = list(tree)
        ul.classList.add('zp-tree')
        page.append(ul)
        // 中身がフォルダ 1 つにまとめてあれば、開いておく
        const only = tree.folders.size === 1 && !tree.files.length ? ul.querySelector('details') : null
        if (only) only.open = true
      })
      .catch((e: unknown) => {
        if (alive) sum.textContent = `読めませんでした：${e instanceof Error ? e.message : String(e)}`
      })
    return () => {
      alive = false
      root.replaceChildren()
    }
  },
})
