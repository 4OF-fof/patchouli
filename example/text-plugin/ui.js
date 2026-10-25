// 動作確認用の組み込み UI。詳細では本文を出し、サムネイルは最初の数行を canvas に描く。

const decode = (buf) => new TextDecoder().decode(buf)

export function mount(el, api) {
  let alive = true
  const head = document.createElement('div')
  head.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;flex-wrap:wrap'
  const info = document.createElement('span')
  info.style.opacity = '0.75'
  const wrap = document.createElement('button')
  const pre = document.createElement('pre')
  pre.style.cssText = 'margin:0;padding:12px 16px'
  head.append(wrap, info)
  el.append(head, pre)

  const render = async () => {
    const [text, s, stats] = await Promise.all([
      api.read(0, 1 << 20).then(decode),
      api.settings(),
      api.call('stats', '').then(JSON.parse),
    ])
    if (!alive) return
    pre.textContent = text
    pre.style.whiteSpace = s.wrap ? 'pre-wrap' : 'pre'
    pre.style.fontSize = `${s.size}px`
    pre.style.fontFamily = s.font === 'mono' ? 'var(--f-mono)' : 'var(--f-sans)'
    wrap.textContent = s.wrap ? '折り返さない' : '折り返す'
    wrap.onclick = () => api.setSetting('wrap', !s.wrap).then(render)
    info.textContent = `${api.item.name}.${api.item.ext} · ${stats.lines} 行 · ${stats.chars} 文字`
  }
  render().catch((e) => {
    pre.textContent = String(e)
  })
  return () => {
    alive = false
  }
}

export async function thumbnail(api) {
  const text = decode(await api.read(0, 4096))
  const w = Math.round(api.edge * 0.8)
  const h = api.edge
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.fillStyle = '#f7f5ef'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#3a3a36'
  g.font = '22px monospace'
  text
    .split('\n')
    .slice(0, 18)
    .forEach((line, i) => g.fillText(line.slice(0, 26), 24, 48 + i * 26))
  const png = await new Promise((r) => c.toBlob(r, 'image/png'))
  return { png }
}
