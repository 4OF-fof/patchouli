/*
 * tally のコードブロック。「名前: 数」の行ごとに − と + を出し、押すと中身の数を書き換える。
 * 下には、WASM が描いた棒グラフを出す。
 */

import { type CodeApi, definePlugin } from '@patchouli/plugin'

const CSS = `
.ec-tally { display: grid; gap: var(--space-8); font: var(--fs-list) var(--f-sans); }
.ec-rows { display: grid; grid-template-columns: auto auto 3em auto; justify-content: start; align-items: center; gap: var(--space-4) var(--space-8); }
.ec-count { text-align: center; font-variant-numeric: tabular-nums; }
.ec-add { display: flex; gap: var(--space-8); }
.ec-chart svg { display: block; max-width: 100%; height: auto; }
`

const LINE = /^(.*?):\s*(\d+)\s*$/

interface Row {
  name: string
  count: number
  line: number
}

const rowsOf = (source: string): Row[] =>
  source.split('\n').flatMap((text, line) => {
    const m = LINE.exec(text)
    return m ? [{ name: (m[1] ?? '').trim(), count: Number(m[2]), line }] : []
  })

const setCount = (api: CodeApi, r: Row, count: number) => {
  const lines = api.source.split('\n')
  lines[r.line] = `${r.name}: ${Math.max(0, count)}`
  api.setSource(lines.join('\n'))
}

const button = (label: string, tip: string, onClick: () => void) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.dataset.tip = tip
  b.addEventListener('click', onClick)
  return b
}

const span = (text: string, className?: string) => {
  const s = document.createElement('span')
  s.textContent = text
  if (className) s.className = className
  return s
}

const shown = new WeakMap<HTMLElement, { rows: HTMLElement; chart: HTMLElement; ticket: number }>()

function show(el: HTMLElement, api: CodeApi) {
  const s = shown.get(el)
  if (!s) return
  s.rows.replaceChildren(
    ...rowsOf(api.source).flatMap((r) => [
      span(r.name),
      button('−', '1 減らす', () => setCount(api, r, r.count - 1)),
      span(String(r.count), 'ec-count'),
      button('+', '1 足す', () => setCount(api, r, r.count + 1)),
    ]),
  )
  const ticket = ++s.ticket
  api.wasm().then(
    (img) => {
      if (s.ticket === ticket && 'svg' in img) s.chart.innerHTML = img.svg
    },
    () => s.ticket === ticket && s.chart.replaceChildren(),
  )
}

export default definePlugin({
  code: {
    tally: {
      render(el, api) {
        const style = document.createElement('style')
        style.textContent = CSS
        const root = document.createElement('div')
        root.className = 'ec-tally'
        const rows = document.createElement('div')
        rows.className = 'ec-rows'
        const form = document.createElement('form')
        form.className = 'ec-add'
        const input = document.createElement('input')
        input.placeholder = '名前'
        input.setAttribute('aria-label', '足す行の名前')
        const add = document.createElement('button')
        add.type = 'submit'
        add.textContent = '行を足す'
        form.append(input, add)
        form.addEventListener('submit', (e) => {
          e.preventDefault()
          const name = input.value.replace(/:/g, '').trim()
          if (!name) return
          input.value = ''
          const before = api.source.replace(/\n+$/, '')
          api.setSource(`${before}${before ? '\n' : ''}${name}: 0`)
        })
        const chart = document.createElement('div')
        chart.className = 'ec-chart'
        root.append(rows, form, chart)
        el.append(style, root)
        shown.set(el, { rows, chart, ticket: 0 })
        show(el, api)
        return () => shown.delete(el)
      },
      update: show,
    },
  },
})
