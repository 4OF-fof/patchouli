import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import type { CodeApi, CodeImage, Fetched, OwnApi } from '../../../plugins/sdk'
import { type CodeView, type NoteSyntax, syntaxOf } from '../../components/editor/NoteEditor/NoteEditor'
import { PluginView } from '../../components/media/PluginView/PluginView'
import { message } from '../../model/busy'
import { cleanSvg } from '../../plugins/svg'
import type { CodeInfo, NotesInfo, UiRef } from '../../plugins/types'
import styles from './code.module.css'

export interface CodeHost {
  uiUrl?: (ui: UiRef) => string
  own: (plugin: string) => OwnApi
  renderCode?: (plugin: string, lang: string, source: string) => Promise<CodeImage>
  fetch?: (plugin: string, url: string) => Promise<Fetched>
}

type Render = NonNullable<CodeHost['renderCode']>

const unavailable = (what: string) => Promise.reject(new Error(`この環境では${what}`))

function scriptView(c: CodeInfo, url: string, host: CodeHost): CodeView {
  const { renderCode, fetch } = host
  return {
    interactive: true,
    class: styles.script,
    mount(el, block) {
      const [source, setSource] = createSignal(block.source)
      const api: CodeApi = {
        ...host.own(c.plugin),
        lang: c.lang,
        get source() {
          return source()
        },
        setSource: (s) => block.setSource(s),
        wasm: () => (renderCode ? renderCode(c.plugin, c.lang, source()) : unavailable('WASM で描けません')),
        fetch: (u) => (fetch ? fetch(c.plugin, u) : unavailable('取りに行けません')),
      }
      const dispose = render(() => <PluginView url={url} api={api} code={c.lang} />, el)
      return { update: (b) => setSource(b.source), destroy: dispose }
    },
  }
}

let sheet: CSSStyleSheet | undefined
const sheetOf = () => {
  if (!sheet) {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(':host { display: block } img, svg { display: block; max-width: 100%; height: auto }')
  }
  return sheet
}

/** WASM が描いた画像。本体の画面の CSS が届かないよう、閉じた shadow root に出す。CSS 変数は届く。 */
function wasmView(c: CodeInfo, renderCode: Render): CodeView {
  return {
    class: styles.wasm,
    mount(el, block) {
      const box = document.createElement('div')
      const shadow = box.attachShadow({ mode: 'closed' })
      shadow.adoptedStyleSheets = [sheetOf()]
      const error = document.createElement('p')
      error.className = styles.error ?? ''
      error.hidden = true
      el.append(box, error)
      let want = block.source
      let drawn: string | undefined
      let busy = false
      let gone = false
      let url: string | undefined
      const free = () => {
        if (url) URL.revokeObjectURL(url)
        url = undefined
      }
      const show = (img: CodeImage) => {
        if ('png' in img) {
          const i = document.createElement('img')
          free()
          url = URL.createObjectURL(new Blob([img.png], { type: 'image/png' }))
          i.src = url
          shadow.replaceChildren(i)
          return
        }
        const svg = cleanSvg(img.svg)
        if (!svg) throw new Error('SVG として読めません')
        free()
        shadow.replaceChildren(svg)
      }
      const draw = () => {
        if (busy || gone || drawn === want) return
        busy = true
        const src = want
        renderCode(c.plugin, c.lang, src)
          .then((img) => {
            if (gone) return
            show(img)
            error.hidden = true
          })
          .catch((e: unknown) => {
            if (gone) return
            error.textContent = `描けませんでした：${message(e)}`
            error.hidden = false
          })
          .finally(() => {
            busy = false
            drawn = src
            draw()
          })
      }
      draw()
      return {
        update: (b) => {
          want = b.source
          draw()
        },
        destroy: () => {
          gone = true
          free()
        },
      }
    },
  }
}

/** ノートに足すものから、ノートの書き方を作る。スクリプトと WASM で描くものは、描ける環境のときだけ描く。 */
export function noteSyntax(info: NotesInfo, host: CodeHost): NoteSyntax {
  const { uiUrl, renderCode } = host
  return syntaxOf(info, (c) => {
    if (c.by === 'script') {
      const url = c.module && uiUrl?.({ plugin: c.plugin, module: c.module })
      return url ? scriptView(c, url, host) : undefined
    }
    if (c.by === 'wasm') return renderCode ? wasmView(c, renderCode) : undefined
    return undefined
  })
}
