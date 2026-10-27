// 組み込み UI。アプリの画面の中で動き、詳細の表示とサムネイルを描く。ビルドすると ui.js（plugin.json の ui）になる。
// 簡単のため、CSV の引用符は扱わない。
import { definePlugin } from '@patchouli/plugin'

/** src/lib.rs の call("summary") が返すもの。 */
interface Summary {
  rows: number
  columns: number
}

/** WASM の call で呼べるものと、設定の型。src/lib.rs と合わせる。 */
interface Csv {
  methods: { summary(): Summary }
  settings: { header: boolean }
}

/** 頭から max 行を読む。 */
const parse = (bytes: Uint8Array, max: number) =>
  new TextDecoder()
    .decode(bytes)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, max)
    .map((line) => line.split(','))

export default definePlugin<Csv>({
  mount(el, api) {
    let alive = true
    const info = document.createElement('p')
    info.style.cssText = 'margin:0;padding:8px 12px;opacity:0.75'
    const table = document.createElement('table')
    table.style.cssText = 'margin:0 12px 12px;border-collapse:collapse'
    el.append(info, table)

    const render = async () => {
      const [bytes, s, summary] = await Promise.all([api.read(0, 1 << 20), api.settings(), api.call('summary')])
      if (!alive) return
      info.textContent = `${summary.rows} 行 · ${summary.columns} 列`
      parse(bytes, 200).forEach((row, i) => {
        const tr = table.insertRow()
        for (const v of row) {
          const cell = document.createElement(s.header && i === 0 ? 'th' : 'td')
          cell.style.cssText = 'padding:2px 8px;border:1px solid var(--line, #8884);text-align:left'
          cell.textContent = v
          tr.append(cell)
        }
      })
    }
    render().catch((e: unknown) => {
      info.textContent = String(e)
    })
    return () => {
      alive = false
    }
  },

  async thumbnail(api) {
    const [bytes, s] = await Promise.all([api.read(0, 16 << 10), api.settings()])
    const rows = parse(bytes, 24)
    const w = api.edge
    const h = Math.round(api.edge / 1.4)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) return null
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, w, h)
    const cols = Math.max(1, Math.min(6, rows[0]?.length ?? 1))
    const cw = w / cols
    const rh = 22
    g.font = '14px sans-serif'
    rows.forEach((row, i) => {
      if (s.header && i === 0) {
        g.fillStyle = '#e8e8e8'
        g.fillRect(0, 0, w, rh)
      }
      g.fillStyle = '#333333'
      row.slice(0, cols).forEach((v, j) => g.fillText(v.slice(0, 12), j * cw + 6, i * rh + 16))
    })
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    return png && { png }
  },
})
