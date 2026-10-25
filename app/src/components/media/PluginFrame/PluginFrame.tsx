import { onCleanup, onMount } from 'solid-js'
import styles from './PluginFrame.module.css'

export interface PluginFrameProps {
  /** プラグインの画面の URL。 */
  url: string
  /** 開いている素材。 */
  file: { name: string; ext: string }
  /** 素材の中身を offset から最大 length バイト読む。 */
  onRead?: (offset: number, length: number) => Promise<ArrayBuffer>
  /** 詳細を受け持つプラグインの WASM の関数を呼ぶ。 */
  onCall?: (method: string, args: string) => Promise<string>
  class?: string
}

/** 画面から届くもの。id は返事に添えて返す。 */
type Request =
  | { type: 'patchouli:read'; id: number; offset: number; length: number }
  | { type: 'patchouli:call'; id: number; method: string; args: string }

const isRequest = (d: unknown): d is Request =>
  typeof d === 'object' &&
  d !== null &&
  'type' in d &&
  'id' in d &&
  typeof d.id === 'number' &&
  (d.type === 'patchouli:read' || d.type === 'patchouli:call')

const theme = () =>
  document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

/**
 * プラグインの画面。origin を持たない iframe（sandbox）で開き、本体とはメッセージだけでやりとりする。
 *
 * - 読み込んだら `{ type: 'patchouli:open', file: { name, ext }, theme }` を送る
 * - 画面は `patchouli:read`（offset, length）と `patchouli:call`（method, args）を送れる。
 *   返事は `{ type: 'patchouli:reply', id, ok, value }` か `{ ..., ok: false, error }`
 */
export function PluginFrame(props: PluginFrameProps) {
  let frame!: HTMLIFrameElement
  const reply = (msg: object, transfer: Transferable[] = []) => frame.contentWindow?.postMessage(msg, '*', transfer)
  const onMessage = async (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || !isRequest(e.data)) return
    const req = e.data
    try {
      if (req.type === 'patchouli:read') {
        if (!props.onRead) throw new Error('読めない')
        const buf = await props.onRead(req.offset, req.length)
        reply({ type: 'patchouli:reply', id: req.id, ok: true, value: buf }, [buf])
      } else {
        if (!props.onCall) throw new Error('呼べない')
        reply({ type: 'patchouli:reply', id: req.id, ok: true, value: await props.onCall(req.method, req.args) })
      }
    } catch (err) {
      reply({ type: 'patchouli:reply', id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  onMount(() => window.addEventListener('message', onMessage))
  onCleanup(() => window.removeEventListener('message', onMessage))
  return (
    <iframe
      ref={frame}
      class={`${styles.root} ${props.class ?? ''}`}
      src={props.url}
      title={props.file.name}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={() => reply({ type: 'patchouli:open', file: { ...props.file }, theme: theme() })}
    />
  )
}
