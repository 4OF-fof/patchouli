import { emitTo } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { LibraryItem, NewNote, ScreenApi } from '../../plugins/sdk'
import { PluginView } from '../components/media/PluginView/PluginView'
import {
  FROM_WINDOW,
  type FromWindow,
  ITEMS,
  REPLY,
  type Reply,
  STATE,
  type WindowCall,
  type WindowState,
} from './protocol'
import styles from './ScreenWindow.module.css'

const post = (m: FromWindow) => void emitTo('main', FROM_WINDOW, m)

/** プラグインの画面だけを出す別のウィンドウ。描くものと項目は本体の窓から受け取る。 */
export function ScreenWindow() {
  const win = getCurrentWebviewWindow()
  const [state, setState] = createSignal<WindowState>()
  const [items, setItems] = createSignal<LibraryItem[]>([])
  const byId = createMemo(() => new Map(items().map((it) => [it.id, it])))
  const subs = new Set<() => void>()
  const pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  let seq = 0

  const call = (c: WindowCall) =>
    new Promise<Reply>((resolve, reject) => {
      const req = ++seq
      pending.set(req, { resolve, reject })
      post({ label: win.label, kind: 'call', req, ...c })
    })
  const done = async (c: WindowCall) => void (await call(c))
  const send = (c: WindowCall) => void call(c).catch((e: unknown) => console.error(e))
  const changed = (list: LibraryItem[]) => {
    setItems(list)
    for (const fn of subs) fn()
  }
  /** 本体の窓から写しが届くまでの間も、書き換えたものを読めるようにする。 */
  const patch = (id: string, p: Partial<LibraryItem>) =>
    changed(items().map((it) => (it.id === id ? { ...it, ...p } : it)))
  const need = (id: string) => {
    const it = byId().get(id)
    if (!it) throw new Error(`項目「${id}」が見つかりません`)
    return it
  }

  onMount(() => {
    const offs = [
      win.listen<WindowState>(STATE, (e) => {
        setItems(e.payload.items)
        setState(e.payload)
      }),
      win.listen<LibraryItem[]>(ITEMS, (e) => changed(e.payload)),
      win.listen<Reply>(REPLY, ({ payload: r }) => {
        const p = pending.get(r.req)
        pending.delete(r.req)
        if (r.error !== undefined) p?.reject(new Error(r.error))
        else p?.resolve(r)
      }),
    ]
    void Promise.all(offs).then(() => post({ label: win.label, kind: 'ready' }))
    onCleanup(() => offs.forEach((o) => void o.then((f) => f())))
  })

  const apiOf = (s: WindowState): ScreenApi => ({
    settings: async () => (await call({ method: 'settings', args: [] })).settings ?? {},
    setSetting: (key, value) => done({ method: 'setSetting', args: [key, value] }),
    getData: async (key) => (await call({ method: 'getData', args: [key] })).data,
    setData: (key, value) => done({ method: 'setData', args: [key, value ?? null] }),
    targets: () => s.targets.flatMap((id) => byId().get(id) ?? []),
    inWindow: true,
    items: () => items(),
    item: (id) => byId().get(id),
    onChange: (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    open: (id, opts) => send({ method: 'open', args: [need(id).id, opts] }),
    openTag: (tag, opts) => send({ method: 'openTag', args: [tag, opts] }),
    openProject: (name, opts) => send({ method: 'openProject', args: [name, opts] }),
    createNote: async (note: NewNote = {}) => {
      const it = (await call({ method: 'createNote', args: [note] })).item
      if (!it) throw new Error('ノートを作成できませんでした')
      return it
    },
    setBody: (id, body) => {
      const it = need(id)
      if (!it.note) throw new Error(`「${it.name}」はノートではありません`)
      if (it.body === body) return
      patch(id, { body })
      send({ method: 'setBody', args: [id, body] })
    },
    setTags: (id, tags) => {
      need(id)
      const t = [...new Set(tags.map((x) => x.trim()).filter(Boolean))]
      patch(id, { tags: t })
      send({ method: 'setTags', args: [id, t] })
    },
    rename: (id, name) => {
      need(id)
      const n = name.trim()
      if (!n) throw new Error('名前が空です')
      patch(id, { name: n })
      send({ method: 'rename', args: [id, n] })
    },
  })

  return (
    <main class={styles.root}>
      <Show when={state()} keyed>
        {(s) => <PluginView url={s.url} api={apiOf(s)} screen={s.screen} class={styles.view} />}
      </Show>
    </main>
  )
}
