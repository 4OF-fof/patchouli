import { type JSX, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { BrowserActions } from '../../../backend/types'
import { Icon } from '../../base/Icon/Icon'
import { Button } from '../../controls/Button/Button'
import { IconButton } from '../../controls/IconButton/IconButton'
import { useHost } from '../../../window/host'
import { useTabShown } from '../../nav/TabPane/TabPane'
import { coverPage, onLayout, setHole } from './layer'
import styles from './WebPage.module.css'

export interface WebPageProps {
  url: string
  /** ないときは iframe で出す（読み込みを断るサイトは出せない）。 */
  browser?: BrowserActions
  onOpenDefault?: (url: string) => void
  /** アドレスバーの行の左端に置くもの。 */
  lead?: JSX.Element
  class?: string
}

/** 外のページ。別のウィンドウに出しているあいだは、WebView を重ねられないので iframe で出す。 */
export function WebPage(props: WebPageProps) {
  const host = useHost()
  return (
    <Show when={host().main} fallback={<Page {...props} browser={undefined} />}>
      <Page {...props} />
    </Show>
  )
}

/**
 * browser があれば、本体とは別の WebView を枠の位置に重ねる。
 * 別の WebView は本体の画面とは別に描かれるので、枠が隠れたり動いたりしたら合わせて隠し、動かす。
 */
function Page(props: WebPageProps) {
  // 画面を読み直しても前の WebView と名前が重ならないようにする
  const key = `page-${crypto.randomUUID()}`
  const active = useTabShown()
  let frame!: HTMLDivElement
  let iframe: HTMLIFrameElement | undefined
  let last = ''
  const [at, setAt] = createSignal(props.url)
  const [can, setCan] = createSignal({ back: false, forward: false })
  const [popup, setPopup] = createSignal<string>()
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
    const offLayout = onLayout(sync)
    const off = props.browser.onMoved((k, p) => {
      if (k !== key) return
      setAt(p.url)
      setCan({ back: p.back, forward: p.forward })
    })
    const offPopup = props.browser.onPopup((k, url) => k === key && props.onOpenDefault && setPopup(url))
    sync()
    onCleanup(() => {
      offLayout()
      off()
      offPopup()
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
  const [copied, setCopied] = createSignal(false)
  let copiedTimer = 0
  onCleanup(() => clearTimeout(copiedTimer))
  const copy = () =>
    navigator.clipboard.writeText(at()).then(
      () => {
        setCopied(true)
        clearTimeout(copiedTimer)
        copiedTimer = window.setTimeout(() => setCopied(false), 1500)
      },
      (e: unknown) => console.warn('URL をコピーできない', e),
    )
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
          <span class={styles.lead}>{props.lead}</span>
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
        <span class={styles.address}>
          <IconButton label={copied() ? 'コピーしました' : 'URL をコピー'} onClick={copy}>
            <Icon name={copied() ? 'check' : 'link'} size={14} />
          </IconButton>
          <span class={styles.url} title={at()}>
            {parts().head}
            <b>{parts().host}</b>
            {parts().rest}
          </span>
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
      <Show when={popup()}>
        {(url) => (
          <div ref={coverPage} class={styles.popup} role="alertdialog" aria-label="新しいウィンドウ">
            <p>ページが新しいウィンドウを開こうとしています</p>
            <span class={styles.popupUrl} title={url()}>
              {url()}
            </span>
            <span class={styles.popupActions}>
              <Button onClick={() => setPopup(undefined)}>キャンセル</Button>
              <Button
                variant="primary"
                onClick={() => {
                  props.onOpenDefault?.(url())
                  setPopup(undefined)
                }}
              >
                既定のブラウザで開く
              </Button>
            </span>
          </div>
        )}
      </Show>
    </div>
  )
}
