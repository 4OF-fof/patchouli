import { definePlugin } from '@patchouli/plugin'
import { type Mounted, mountAsync } from 'pele/lazy'

const STYLE = `
.patchouli-mermaid {
  --pele-bg: transparent;
  --pele-fg: var(--ink);
  --pele-muted: var(--muted);
  --pele-line: var(--ink-2);
  --pele-surface: var(--side);
  --pele-surface-alt: var(--card);
  --pele-border: var(--line-2);
  --pele-accent: var(--accent);
  --pele-font: inherit;
  --pele-radius: var(--radius-sm);
  padding: var(--space-4) 0;
  overflow-x: auto;
  line-height: normal;
}
.patchouli-mermaid:empty {
  display: none;
}
`

interface Drawn {
  box: HTMLElement
  src: string
  mounted?: Mounted
  loading: boolean
  gone: boolean
}

const drawn = new WeakMap<HTMLElement, Drawn>()

function draw(d: Drawn) {
  if (!d.src.trim()) {
    d.mounted?.destroy()
    d.mounted = undefined
    d.box.replaceChildren()
    return
  }
  if (d.mounted) {
    if (d.mounted.source !== d.src) d.mounted.update(d.src)
    return
  }
  if (d.loading) return
  d.loading = true
  void mountAsync(d.box, d.src).then((m) => {
    d.loading = false
    if (d.gone) return m.destroy()
    d.mounted = m
    if (m.source !== d.src) draw(d)
    return undefined
  })
}

export default definePlugin({
  code: {
    mermaid: {
      render(el, api) {
        const style = document.createElement('style')
        style.textContent = STYLE
        const box = document.createElement('div')
        box.className = 'patchouli-mermaid'
        el.replaceChildren(style, box)
        const d: Drawn = { box, src: api.source, loading: false, gone: false }
        drawn.set(el, d)
        draw(d)
        return () => {
          d.gone = true
          d.mounted?.destroy()
          drawn.delete(el)
        }
      },
      update(el, api) {
        const d = drawn.get(el)
        if (!d) return
        d.src = api.source
        draw(d)
      },
    },
  },
})
