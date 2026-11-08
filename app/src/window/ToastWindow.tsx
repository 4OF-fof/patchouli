import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Window as TauriWindow } from '@tauri-apps/api/window'
import { type JSX, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { DelegatedEvents, Portal, delegateEvents } from 'solid-js/web'
import { nextPopout } from './controls'
import { type Host, HostProvider } from './host'
import { forward, mirror } from './Popout'
import styles from './ToastWindow.module.css'

/** 窓を閉じられたか、中身が作り直されたかを見る間隔（ms）。 */
const POLL = 250
/** 開いたときの大きさ。中身を描いたら、中身に合わせる。 */
const FIRST = { w: 412, h: 96 }

/** トレイに隠した本体のウィンドウを出す。 */
export function showMain() {
  if (isTauri()) void invoke('show_app').catch(() => {})
}

export interface ToastWindowProps {
  /** 中で一覧やメニューを開いているあいだは、その分だけ窓を広げておく。 */
  room?: { w: number; h: number }
  onClosed?: () => void
  children: JSX.Element
}

/**
 * 画面の右下に出すトーストの窓。ほかのアプリを使っているあいだにも出すので、フォーカスを取らない窓を Rust 側で作る。
 * 中身は本体の窓の JS が描き、窓の大きさは中身に合わせる。デスクトップのほかでは何も出さない
 */
export function ToastWindow(props: ToastWindowProps) {
  const [host, setHost] = createSignal<Host>()
  let win: Window | null = null
  let frame: Promise<TauriWindow | null> | undefined
  let poll = 0
  const check = () => {
    if (!win) return
    if (win.closed) {
      win = null
      setHost(undefined)
      props.onClosed?.()
      return
    }
    const doc = win.document
    if (doc !== host()?.doc && doc.readyState === 'complete' && doc.body) setHost({ win, doc, main: false })
  }
  onMount(() => {
    if (!isTauri()) return
    let gone = false
    void invoke('expect_toast')
      .then(() => {
        if (gone) return
        frame = nextPopout()
        win = window.open('', '', `popup,width=${FIRST.w},height=${FIRST.h}`)
        if (!win) props.onClosed?.()
        poll = window.setInterval(check, POLL)
        check()
      })
      .catch(() => props.onClosed?.())
    onCleanup(() => {
      gone = true
      clearInterval(poll)
      // 開いた側からの window.close は中の WebView だけを消すので、Tauri の窓として閉じる
      const w = win
      if (w && !w.closed) void (frame ?? Promise.resolve(null)).then((f) => (f ? f.close() : w.close()))
    })
  })
  createEffect(() => {
    const h = host()
    if (!h) return
    const stopMirror = mirror(h.doc)
    const stopForward = forward(h.win)
    delegateEvents([...DelegatedEvents], h.doc)
    h.doc.title = 'Patchouli'
    h.doc.body.style.background = 'transparent'
    h.doc.body.style.overflow = 'hidden'
    onCleanup(() => {
      stopMirror()
      stopForward()
    })
  })
  const fit = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const room = props.room
    const w = Math.ceil(Math.max(r.width, room?.w ?? 0))
    const h = Math.ceil(Math.max(r.height, room?.h ?? 0))
    if (w && h) void invoke('place_toast', { width: w, height: h }).catch(() => {})
  }
  return (
    <Show when={host()} keyed>
      {(h) => (
        <Portal mount={h.doc.body}>
          <HostProvider value={() => h}>
            <div class={styles.stage}>
              <div
                ref={(el) => {
                  const ro = new ResizeObserver(() => fit(el))
                  ro.observe(el)
                  createEffect(() => fit(el))
                  onCleanup(() => ro.disconnect())
                }}
                class={styles.stack}
              >
                {props.children}
              </div>
            </div>
          </HostProvider>
        </Portal>
      )}
    </Show>
  )
}
