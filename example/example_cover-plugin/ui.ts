/*
 * タグとプロジェクトの概要のカード。
 * goal は、編集中に目標の件数を入れてカードに残し、いまの件数との進み具合を出す。
 * months は、項目を更新した月ごとに数え、直近 6 か月の棒にする。
 */

import { type CoverApi, type Json, definePlugin } from '@patchouli/plugin'

const MONTHS = 6

const CSS = `
.xc-card { display: grid; gap: var(--space-6); font: var(--fs-list) var(--f-sans); }
.xc-muted { color: var(--muted); }
.xc-head { display: flex; align-items: baseline; gap: var(--space-8); }
.xc-count { font-size: var(--fs-title); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
.xc-left { margin-left: auto; font-size: var(--fs-meta); color: var(--muted); }
.xc-left[data-done] { color: var(--accent); }
.xc-track { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.xc-fill { height: 100%; border-radius: inherit; background: var(--accent); }
.xc-field { display: flex; align-items: center; gap: var(--space-8); }
.xc-field input { width: 7em; }
.xc-rows { display: grid; grid-template-columns: auto minmax(0, 1fr) 2.5em; align-items: center; gap: var(--space-4) var(--space-8); }
.xc-month, .xc-n { font: var(--fs-meta) var(--f-mono); color: var(--muted); }
.xc-n { text-align: right; }
.xc-bar { height: 6px; border-radius: 3px; background: var(--accent); }
`

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** カードに残した目標の件数。 */
const targetOf = (value: Json | undefined) => {
  const t = value && typeof value === 'object' && !Array.isArray(value) ? value.target : undefined
  return typeof t === 'number' && t > 0 ? t : undefined
}

function goal(root: HTMLElement, api: CoverApi) {
  const card = el('div', 'xc-card')
  root.append(el('style', undefined, CSS), card)

  const field = () => {
    const label = el('label', 'xc-field')
    const input = el('input')
    input.type = 'number'
    input.min = '1'
    input.step = '1'
    input.placeholder = '目標なし'
    input.value = String(targetOf(api.value) ?? '')
    input.addEventListener('change', () => {
      const n = Math.round(Number(input.value))
      api.setValue(input.value && n > 0 ? { target: n } : undefined)
      draw()
    })
    label.append(el('span', undefined, '目標'), input, el('span', 'xc-muted', '件'))
    return label
  }

  const progress = (n: number, target: number) => {
    const head = el('div', 'xc-head')
    head.append(el('span', 'xc-count', `${n}`), el('span', 'xc-muted', `/ ${target} 件`))
    const left = el('span', 'xc-left', n >= target ? '達成しました' : `あと ${target - n} 件`)
    if (n >= target) left.dataset.done = ''
    head.append(left)
    const track = el('div', 'xc-track')
    const fill = el('div', 'xc-fill')
    fill.style.width = `${Math.min(1, n / target) * 100}%`
    track.append(fill)
    return [head, track]
  }

  const draw = () => {
    const target = targetOf(api.value)
    const n = api.items().length
    const parts: HTMLElement[] = target ? progress(n, target) : []
    if (api.editing) parts.push(field())
    else if (!target) parts.push(el('span', 'xc-muted', '目標はまだありません'))
    card.replaceChildren(...parts)
  }

  draw()
  const stops = [api.onChange(draw), api.onEditing(draw)]
  return () => {
    for (const stop of stops) stop()
    root.replaceChildren()
  }
}

const monthKey = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`

function months(root: HTMLElement, api: CoverApi) {
  const card = el('div', 'xc-card')
  root.append(el('style', undefined, CSS), card)

  const draw = () => {
    const counts = new Map<string, number>()
    for (const it of api.items())
      if (it.mtime !== undefined) {
        const k = monthKey(new Date(it.mtime))
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    const now = new Date()
    const keys = Array.from({ length: MONTHS }, (_, i) =>
      monthKey(new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1)),
    )
    const most = Math.max(1, ...keys.map((k) => counts.get(k) ?? 0))
    const rows = el('div', 'xc-rows')
    for (const k of keys) {
      const n = counts.get(k) ?? 0
      const bar = el('div', 'xc-bar')
      bar.style.width = `${(n / most) * 100}%`
      rows.append(el('span', 'xc-month', k), bar, el('span', 'xc-n', `${n}`))
    }
    card.replaceChildren(rows)
  }

  draw()
  const stop = api.onChange(draw)
  return () => {
    stop()
    root.replaceChildren()
  }
}

export default definePlugin({
  covers: {
    goal: { mount: goal },
    months: { mount: months },
  },
})
