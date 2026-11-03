import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { BrowserActions } from '../../../backend/types'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'
import { useTabActive } from '../../nav/TabPane/TabPane'
import { setHole } from './layer'
import styles from './WebPage.module.css'

export interface WebPageProps {
  url: string
  /** ないときは iframe で出す（読み込みを断るサイトは出せない）。 */
  browser?: BrowserActions
  onOpenDefault?: (url: string) => void
  class?: string
}

/**
 * 外のページ。browser があれば、本体とは別の WebView を枠の位置に重ねる。
 * 別の WebView は本体の画面とは別に描かれるので、枠が隠れたり動いたりしたら合わせて隠し、動かす。
 */
export function WebPage(props: WebPageProps) {
  // 画面を読み直しても前の WebView と名前が重ならないようにする
  const key = `page-${crypto.randomUUID()}`
  const active = useTabActive()
  let frame!: HTMLDivElement
  let iframe: HTMLIFrameElement | undefined
  let last = ''
  const [at, setAt] = createSignal(props.url)
  const [can, setCan] = createSignal({ back: false, forward: false })
  createEffect(() => setAt(props.url))
  const sync = () => {
    const b = props.browser
    if (!b) return
    const r = frame.getBoundingClientRect()
    const shown =
      active() &&
      frame.isConnected &&
      r.width > 0 &&
      r.height > 0 &&
      frame.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    const now = shown ? `${props.url} ${r.left} ${r.top} ${r.width} ${r.height}` : ''
    if (now === last) return
    last = now
    setHole(key, shown ? frame : undefined, b)
    const done = shown ? b.show(key, props.url, { x: r.left, y: r.top, width: r.width, height: r.height }) : b.hide(key)
    done.catch((e: unknown) => console.warn('外のページを出せない', e))
  }
  onMount(() => {
    if (!props.browser) return
    // 位置だけが変わったときは知らせがないので、ときどき確かめる
    const timer = window.setInterval(sync, 200)
    const ro = new ResizeObserver(sync)
    ro.observe(frame)
    const off = props.browser.onMoved((k, p) => {
      if (k !== key) return
      setAt(p.url)
      setCan({ back: p.back, forward: p.forward })
    })
    sync()
    onCleanup(() => {
      clearInterval(timer)
      ro.disconnect()
      off()
      setHole(key, undefined)
      props.browser?.close(key).catch((e: unknown) => console.warn('外のページを閉じられない', e))
    })
  })
  createEffect(() => {
    active()
    if (props.url) sync()
  })
  const parts = () => {
    try {
      const u = new URL(at())
      return { head: `${u.protocol}//`, host: u.host, rest: at().slice(u.protocol.length + 2 + u.host.length) }
    } catch {
      return { head: '', host: at(), rest: '' }
    }
  }
  const go = (to: 'back' | 'forward' | 'reload') => {
    if (props.browser) {
      props.browser.go(key, to).catch((e: unknown) => console.warn('外のページを動かせない', e))
    } else if (to === 'reload' && iframe) {
      iframe.src = props.url
    }
  }
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <div class={styles.bar}>
        <span class={styles.side}>
          <IconButton label="戻る" disabled={!can().back} onClick={() => go('back')}>
            <Icon name="goBack" size={16} />
          </IconButton>
          <IconButton label="進む" disabled={!can().forward} onClick={() => go('forward')}>
            <Icon name="goForward" size={16} />
          </IconButton>
          <IconButton label="再読み込み" onClick={() => go('reload')}>
            <Icon name="reload" size={15} />
          </IconButton>
        </span>
        <span class={styles.url} title={at()}>
          {parts().head}
          <b>{parts().host}</b>
          {parts().rest}
        </span>
        <span class={`${styles.side} ${styles.end}`}>
          <Show when={props.onOpenDefault}>
            {(open) => (
              <IconButton label="既定のブラウザで開く" onClick={() => open()(at())}>
                <Icon name="external" size={16} />
              </IconButton>
            )}
          </Show>
        </span>
      </div>
      <Show
        when={props.browser}
        fallback={
          <iframe
            ref={iframe}
            class={styles.frame}
            src={props.url}
            title={parts().host}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        }
      >
        <div ref={frame} class={styles.frame} />
      </Show>
    </div>
  )
}
