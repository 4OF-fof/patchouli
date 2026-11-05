import { type JSX, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { DelegatedEvents, Portal, delegateEvents } from 'solid-js/web'
import type { Window as TauriWindow } from '@tauri-apps/api/window'
import { Stage } from '../components/nav/SplitView/Stage'
import { TitleBar } from '../components/nav/TitleBar/TitleBar'
import { createPopoutControls } from './controls'
import { type Host, HostProvider } from './host'
import { relayed, watchViewport } from './viewport'
import styles from './Popout.module.css'

/** 窓が閉じられたか、中身が作り直されたかを見る間隔（ms）。 */
const POLL = 250

/** 本体の窓の見た目（style と link、html の属性）を、別のウィンドウに写し続ける。 */
function mirror(doc: Document) {
  const copy = () => {
    for (const el of doc.head.querySelectorAll('[data-mirror]')) el.remove()
    for (const el of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      const c = el.cloneNode(true)
      if (!(c instanceof HTMLElement)) continue
      c.dataset.mirror = ''
      doc.head.append(c)
    }
  }
  const attrs = () => {
    const from = document.documentElement
    const to = doc.documentElement
    for (const name of to.getAttributeNames()) if (!from.hasAttribute(name)) to.removeAttribute(name)
    for (const a of from.attributes) to.setAttribute(a.name, a.value)
  }
  copy()
  attrs()
  let queued = false
  const head = new MutationObserver(() => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      copy()
    })
  })
  head.observe(document.head, { childList: true, subtree: true, characterData: true })
  const html = new MutationObserver(attrs)
  html.observe(document.documentElement, { attributes: true })
  return () => {
    head.disconnect()
    html.disconnect()
  }
}

/** 送った先で入力欄の上かを見分けられるよう、target は元のものにする。 */
const send = (e: Event, c: Event) => {
  Object.defineProperty(c, 'target', { value: e.target })
  relayed.add(c)
  window.dispatchEvent(c)
  if (c.defaultPrevented) e.preventDefault()
}
const key = (e: KeyboardEvent) => send(e, new KeyboardEvent(e.type, e))
const pointer = (e: PointerEvent) => send(e, new PointerEvent(e.type, e))
/** WebView の標準のメニューは出さない。 */
const noMenu = (e: MouseEvent) => e.preventDefault()

/** 窓全体で受ける操作は、部品が本体の window に付けているので、別のウィンドウで起きたものを写して本体の window に送る。 */
function forward(win: Window) {
  win.addEventListener('keydown', key)
  win.addEventListener('keyup', key)
  win.addEventListener('pointermove', pointer)
  win.addEventListener('pointerup', pointer)
  win.addEventListener('pointercancel', pointer)
  win.document.addEventListener('contextmenu', noMenu)
  return () => {
    win.removeEventListener('keydown', key)
    win.removeEventListener('keyup', key)
    win.removeEventListener('pointermove', pointer)
    win.removeEventListener('pointerup', pointer)
    win.removeEventListener('pointercancel', pointer)
    win.document.removeEventListener('contextmenu', noMenu)
  }
}

export interface PopoutProps {
  /** window.open で開いた窓。中身は本体の窓の JS が描く。 */
  win: Window
  /** デスクトップでの、その窓。窓のボタンとタイトルバーでのドラッグに使う。 */
  frame?: Promise<TauriWindow | null>
  title: string
  /** タイトルバーに並べるもの。 */
  bar?: JSX.Element
  /** タブの画面を置く面ができたとき。窓の中身が作り直されたら、また呼ぶ。 */
  onStage: (el: HTMLElement | undefined) => void
  onFocus: () => void
  onClosed: () => void
  /** タブの画面に重ねるもの（ペインの境目など）。 */
  children?: JSX.Element
}

/** タブを出す別のウィンドウ。閉じたら onClosed を呼び、この部品がなくなったら窓も閉じる。 */
export function Popout(props: PopoutProps) {
  const [host, setHost] = createSignal<Host>()
  const frame = props.frame && createPopoutControls(props.frame)
  const check = () => {
    const w = props.win
    if (w.closed) {
      props.onClosed()
      return
    }
    // 開いた直後の空のページは、WebView によっては読み込み直されて入れ替わる
    const doc = w.document
    if (doc !== host()?.doc && doc.readyState === 'complete' && doc.body) setHost({ win: w, doc, main: false })
  }
  // デスクトップでは、開いた側からの window.close は中の WebView だけを消し、窓を白いまま残すので、Tauri の窓として閉じる
  const close = () => {
    if (props.frame) void props.frame.then((w) => (w ? w.close() : props.win.close()))
    else props.win.close()
  }
  const focus = () => props.onFocus()
  onMount(() => {
    const t = setInterval(check, POLL)
    window.addEventListener('pagehide', close)
    check()
    onCleanup(() => {
      clearInterval(t)
      window.removeEventListener('pagehide', close)
      if (!props.win.closed) close()
    })
  })
  createEffect(() => {
    const h = host()
    if (!h) return
    const stopMirror = mirror(h.doc)
    const stopForward = forward(h.win)
    const stopViewport = watchViewport(h.win)
    delegateEvents([...DelegatedEvents], h.doc)
    h.win.addEventListener('focus', focus)
    // Tauri が窓に入れる仕組みがあれば、タイトルバーでのドラッグはそれに任せる
    const drag = frame && !('__TAURI_INTERNALS__' in h.win) ? frame.onDragRegion : undefined
    if (drag) h.doc.addEventListener('mousedown', drag)
    onCleanup(() => {
      if (drag) h.doc.removeEventListener('mousedown', drag)
      stopMirror()
      stopForward()
      stopViewport()
      h.win.removeEventListener('focus', focus)
    })
  })
  createEffect(() => {
    const h = host()
    if (h) h.doc.title = props.title
  })
  return (
    <Show when={host()} keyed>
      {(h) => {
        onCleanup(() => props.onStage(undefined))
        return (
          <Portal mount={h.doc.body}>
            <HostProvider value={() => h}>
              <div class={styles.root}>
                <div class={styles.bar}>
                  <TitleBar window={frame?.controls}>{props.bar}</TitleBar>
                </div>
                <div class={styles.body}>
                  <Stage ref={(el) => props.onStage(el)}>{props.children}</Stage>
                </div>
              </div>
            </HostProvider>
          </Portal>
        )
      }}
    </Show>
  )
}
