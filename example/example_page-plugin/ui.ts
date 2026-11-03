/*
 * すべてのノートをカードにして並べる画面。ピン留めしたものを先に並べ、残りを並べ方の設定に合わせる。
 * カードには、本文で最初に埋め込んだ素材のサムネイルか、本文の頭の数行を出す。
 */

import { type LibraryItem, type ScreenApi, definePlugin } from '@patchouli/plugin'

type Sort = 'moved' | 'name'

const FIRST = 120
const MORE = 120
const LINES = 10
const SORT_KEY = 'sort'

const EMBED_RE = /!\[(?:\\.|[^\]\\])*\]\(patchouli:([^)\s?]+)[^)\s]*\)/g
const FENCE_RE = /^ {0,3}(```|~~~)/

const CSS = `
.nc-page { padding: var(--space-28); }
.nc-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-8) var(--space-16); }
.nc-head h1 { margin: 0; font-size: var(--fs-title); font-weight: 700; line-height: 1.2; }
.nc-count { font-size: var(--fs-meta); color: var(--muted); }
.nc-tools { display: flex; align-items: center; gap: var(--space-8); margin-left: auto; align-self: center; }
.nc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(168px * var(--card-scale, 1)), 1fr));
  gap: var(--space-12);
  padding-top: var(--space-16);
}
.nc-rule { grid-column: 1 / -1; height: 0; border-top: 1px solid var(--line-2); margin: var(--space-4) 0; }
.nc-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  height: auto;
  aspect-ratio: 1;
  min-width: 0;
  padding: var(--space-10) var(--space-12) var(--space-12);
  overflow: hidden;
  border: 0;
  border-top: 3px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--card);
  color: var(--ink);
  text-align: left;
  font-size: var(--fs-meta);
  cursor: pointer;
}
.nc-card:hover { border-top-color: var(--accent); box-shadow: var(--shadow-pill); }
.nc-card[data-pinned] { border-top-color: var(--accent); }
.nc-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: var(--fs-list);
  font-weight: 700;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.nc-text {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  color: var(--muted);
  line-height: 1.55;
  white-space: pre-line;
  overflow-wrap: anywhere;
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}
.nc-image { flex: 1; min-height: 0; width: 100%; object-fit: cover; border-radius: var(--radius-sm); }
.nc-none { padding: var(--space-48) 0; text-align: center; color: var(--muted); font-size: var(--fs-list); }
.nc-more { height: 1px; }
`

/** 本文で最初に埋め込んだ素材のサムネイル。 */
function imageOf(body: string, api: ScreenApi): string | undefined {
  for (const m of body.matchAll(EMBED_RE)) {
    const it = m[1] ? api.item(m[1]) : undefined
    if (it && !it.note && it.thumb) return it.thumb
  }
  return undefined
}

/** 本文の頭の数行。書式の記号と埋め込みを外し、リンクは名前だけにする。 */
function linesOf(body: string): string {
  const out: string[] = []
  let fence = false
  for (const raw of body.split('\n')) {
    if (FENCE_RE.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const line = raw
      .replace(/!\[(?:\\.|[^\]\\])*\]\([^)]*\)/g, '')
      .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(?:#{1,6}\s+|(?:>\s?)+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
      .replace(/[*_`~]+/g, '')
      .replace(/\\([!-/:-@[-`{-~])/g, '$1')
      .trim()
    if (line && !/^\|?\s*:?-{3,}/.test(line)) out.push(line)
    if (out.length >= LINES) break
  }
  return out.join('\n')
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function mount(root: HTMLElement, api: ScreenApi) {
  let sort: Sort = 'moved'
  let shown = FIRST

  const style = el('style', undefined, CSS)
  const page = el('div', 'nc-page')
  const head = el('header', 'nc-head')
  const count = el('span', 'nc-count')
  const tools = el('span', 'nc-tools')
  const select = el('select')
  select.setAttribute('aria-label', '並べ方')
  for (const [value, label] of [
    ['moved', '更新した順'],
    ['name', '名前の順'],
  ] as const) {
    const o = el('option', undefined, label)
    o.value = value
    select.append(o)
  }
  const create = el('button', undefined, '新しいノート')
  create.type = 'button'
  tools.append(select, create)
  head.append(el('h1', undefined, 'ノートのカード'), count, tools)
  const grid = el('div', 'nc-grid')
  const more = el('div', 'nc-more')
  page.append(head, grid, more)
  root.append(style, page)

  const open = (id: string, newTab: boolean) => api.open(id, { newTab })

  const card = (it: LibraryItem) => {
    const b = el('button', 'nc-card')
    b.type = 'button'
    if (it.pinned) b.dataset.pinned = ''
    b.append(el('span', 'nc-title', it.name))
    const body = it.body ?? ''
    const src = imageOf(body, api)
    if (src) {
      const img = el('img', 'nc-image')
      img.src = src
      img.alt = ''
      img.loading = 'lazy'
      b.append(img)
    } else {
      b.append(el('span', 'nc-text', linesOf(body)))
    }
    b.addEventListener('click', (e) => open(it.id, e.ctrlKey || e.metaKey))
    b.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault())
    b.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      open(it.id, true)
    })
    return b
  }

  const notes = () => {
    const by =
      sort === 'name'
        ? (a: LibraryItem, b: LibraryItem) => a.name.localeCompare(b.name, 'ja')
        : (a: LibraryItem, b: LibraryItem) => (b.mtime ?? 0) - (a.mtime ?? 0)
    return api
      .items()
      .filter((it) => it.note)
      .toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || by(a, b))
  }

  const render = () => {
    const list = notes()
    count.textContent = `${list.length} 件`
    if (!list.length) {
      grid.replaceChildren(el('p', 'nc-none', 'まだノートがありません'))
      return
    }
    const cards: HTMLElement[] = []
    list.slice(0, shown).forEach((it, i) => {
      const prev = list[i - 1]
      if (prev?.pinned && !it.pinned) cards.push(el('div', 'nc-rule'))
      cards.push(card(it))
    })
    grid.replaceChildren(...cards)
  }

  const seen = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting) || shown >= notes().length) return
    shown += MORE
    render()
  })
  seen.observe(more)

  select.addEventListener('change', () => {
    sort = select.value === 'name' ? 'name' : 'moved'
    shown = FIRST
    render()
    void api.setData(SORT_KEY, sort)
  })
  create.addEventListener('click', async () => {
    const it = await api.createNote()
    api.open(it.id)
  })

  const stop = api.onChange(render)
  render()
  void api.getData(SORT_KEY).then((v) => {
    if (v !== 'name' && v !== 'moved') return
    sort = v
    select.value = v
    render()
  })

  return () => {
    stop()
    seen.disconnect()
  }
}

export default definePlugin({
  screens: { cards: { mount } },
})
