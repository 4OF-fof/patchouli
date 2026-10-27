/* デスクトップ（Tauri）の窓口。ファイルの読み書きとサムネイル作りは Rust 側（src-tauri/src/）がする。 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  type ItemUrls,
  type StoredChanged,
  type StoredItem,
  type StoredLibrary,
  type StoredProject,
  toChanged,
  toItem,
  toOpened,
  toProject,
} from './stored'
import type { Thumbnail } from '../model/library'
import type { FormatInfo, Part, PluginReport, PluginSource, SettingValue, UiRef } from '../plugins/types'
import { ThumbnailTimeout, type UiApi, type UiItem, uiThumbnail } from '../plugins/ui'
import errorThumb from './thumb-error.svg'
import type { Backend, CacheUsage, Changed, Dropped, FileDrag, KnownLibrary, UnusedPlugin } from './types'

/** Rust から届く項目。file はファイルの場所、thumb はできているサムネイルの場所。 */
type TauriItem = StoredItem & { file: string; thumb?: string }

const urlsOf = (it: TauriItem): ItemUrls => ({
  src: it.note ? undefined : convertFileSrc(it.file),
  thumb: it.thumb && convertFileSrc(it.thumb),
})

/** Rust から届く、詳細に出すもの。ui はプラグインの id と、そのフォルダの中の ES モジュールのパス。decoded は item_decoded で PNG を受け取る。 */
type TauriView = { kind: 'image' | 'video' | 'audio' | 'decoded' } | { kind: 'ui'; plugin: string; module: string }

/** プラグインのフォルダの中のファイルの URL（src-tauri/src/plugin/files.rs が返す）。 */
const pluginUrl = (plugin: string, path: string) =>
  convertFileSrc('', 'plugin') + [plugin, ...path.split('/')].map(encodeURIComponent).join('/')

/** 読んだ key を read に足していく設定の値。 */
const watched = (s: Record<string, SettingValue>, read: Set<string>) =>
  new Proxy(s, {
    get(t, k) {
      if (typeof k === 'string' && Object.hasOwn(t, k)) read.add(k)
      return Reflect.get(t, k)
    },
    ownKeys(t) {
      for (const k of Object.keys(t)) read.add(k)
      return Reflect.ownKeys(t)
    },
  })

/** 見出しに載せられるよう、ASCII でない文字を \uXXXX にした JSON。 */
const asciiJson = (v: unknown) =>
  JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

const uiItemOf = (it: TauriItem): UiItem => ({ id: it.id, name: it.name, ext: it.ext, url: convertFileSrc(it.file) })

/** 画面の位置（物理 px）を CSS の px にする。 */
const at = (p: { x: number; y: number }) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio })

export function tauriBackend(): Backend {
  // 開いた直後からサムネイルが届くので、画面が受け取れるようになるまで溜めておく
  const ready: [string, Thumbnail][] = []
  const subs = new Set<(id: string, thumb: Thumbnail) => void>()
  const sendThumb = (id: string, t: Thumbnail) => {
    if (subs.size) for (const cb of subs) cb(id, t)
    else ready.push([id, t])
  }
  let listening: Promise<unknown> | undefined
  const listenThumbs = () =>
    (listening ??= listen<{ id: string; file: string; width: number; height: number }>('thumbnail', (e) => {
      const p = e.payload
      sendThumb(p.id, { url: convertFileSrc(p.file), ratio: p.width / p.height })
    }))
  // 写しから開いたあとの突き合わせの結果も、画面が受け取れるようになるまで溜めておく
  const changes: Changed[] = []
  const changeSubs = new Set<(c: Changed) => void>()
  let listeningChanges: Promise<unknown> | undefined
  const listenChanges = () =>
    (listeningChanges ??= listen<StoredChanged<TauriItem>>('library-changed', (e) => {
      const c = toChanged(e.payload, new Date(), formats, urlsOf)
      void makeUiThumbs(e.payload.items.toSorted((a, b) => b.mtime - a.mtime))
      if (changeSubs.size) for (const cb of changeSubs) cb(c)
      else changes.push(c)
    }))
  // 開いたライブラリで扱える形式。あとから足す項目にも使う
  let formats = new Map<string, FormatInfo>()

  // WASM が PNG にした詳細の画像。次の素材を開くときに捨てる
  let decoded: string | undefined

  // 落としたもののパスは画面に渡さず、取り込むときまでここで持つ
  let dropped: string[] = []

  // 設定を変えると、その設定を読んで作ったサムネイルのうち、組み込み UI が作るものが返ってくる
  const setSetting = async (plugin: string, key: string, value: SettingValue) => {
    void makeUiThumbs(await invoke<TauriItem[]>('set_plugin_setting', { id: plugin, key, value }))
  }

  const uiApi = (item: UiItem, part: Part, plugin: string): UiApi => ({
    item,
    read: (offset, length) => invoke<ArrayBuffer>('plugin_read', { id: item.id, offset, length }),
    call: (method, args) => invoke<string>('plugin_call', { id: item.id, part, method, args }),
    plugin: (dep) => ({
      call: (method, args) => invoke<string>('plugin_call', { id: item.id, part, plugin: dep, method, args }),
    }),
    settings: () => invoke('plugin_settings', { plugin }),
    setSetting: (key, value) => setSetting(plugin, key, value),
    getData: async (key) => (await invoke<string | null>('plugin_data', { plugin, key })) ?? undefined,
    setData: (key, value) => invoke('set_plugin_data', { plugin, key, value: value ?? null }),
  })

  // 読んだ設定を Rust に渡し、その値が変わったときに作り直せるようにする
  const makeUiThumb = async (it: TauriItem, ui: UiRef) => {
    const read = new Set<string>()
    const api = uiApi(uiItemOf(it), 'thumbnail', ui.plugin)
    const t = await uiThumbnail(pluginUrl(ui.plugin, ui.module), {
      ...api,
      settings: async () => watched(await api.settings(), read),
    }).catch((e: unknown) => {
      if (!(e instanceof ThumbnailTimeout)) throw e
      // 過ぎたらエラー用のサムネイルを出し、次へ進む
      console.warn(`サムネイルが ${e.ms / 1000} 秒で作り終わらない: ${it.name}.${it.ext}`)
      sendThumb(it.id, { url: errorThumb, ratio: formats.get(it.ext)?.ratio ?? 1 })
      return null
    })
    if (!t) return
    const headers: Record<string, string> = { id: it.id, settings: asciiJson([...read]) }
    if (t.width && t.height) Object.assign(headers, { width: `${t.width}`, height: `${t.height}` })
    await invoke('put_thumbnail', t.png, { headers })
  }

  // 組み込み UI が作るサムネイルは、画面で 1 つずつ作って Rust に置かせる（できたら thumbnail が届く）
  const uiQueue: TauriItem[] = []
  let making = false
  const makeUiThumbs = async (items: TauriItem[]) => {
    uiQueue.push(...items.filter((it) => !it.note && !it.thumb && formats.get(it.ext)?.uiThumbnail))
    if (making) return
    making = true
    try {
      for (let it = uiQueue.shift(); it; it = uiQueue.shift()) {
        const ui = formats.get(it.ext)?.uiThumbnail
        if (!ui) continue
        try {
          await makeUiThumb(it, ui)
        } catch (e) {
          console.warn(`サムネイルを作れない: ${it.name}.${it.ext}`, e)
        }
      }
    } finally {
      making = false
    }
  }

  return {
    async open() {
      await Promise.all([listenThumbs(), listenChanges()])
      const s = await invoke<StoredLibrary<TauriItem>>('open_library')
      formats = new Map(s.formats.map((f) => [f.ext, f]))
      void makeUiThumbs(s.items.toSorted((a, b) => b.mtime - a.mtime))
      return toOpened(s, new Date(), urlsOf)
    },
    async saveItem(id, patch) {
      const it = await invoke<TauriItem | null>('save_item', { id, patch })
      return it ? toItem(it, new Date(), formats, urlsOf(it)) : undefined
    },
    async moveItem(id, folder) {
      const it = await invoke<TauriItem>('move_item', { id, folder })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    saveState: (state) => invoke('save_state', { state }),
    async createNote(name, folder) {
      const it = await invoke<TauriItem>('create_note', { name, folder })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    async createProject(name) {
      return toProject(await invoke<StoredProject>('create_project', { name }), new Date())
    },
    saveProject: (name, cover) => invoke('save_project', { name, cover }),
    chooseLibrary: () => invoke<boolean>('choose_library'),
    libraries: {
      list: () => invoke<KnownLibrary[]>('libraries'),
      switch: (path) => invoke('switch_library', { path }),
      forget: (path) => invoke('forget_library', { path }),
    },
    tidy: {
      usage: () => invoke<CacheUsage>('cache_usage'),
      clear: (kind) => invoke('clear_cache', { kind }),
      unusedPlugins: () => invoke<UnusedPlugin[]>('unused_plugins'),
      removeUnusedPlugins: () => invoke('remove_unused_plugins'),
    },
    onFileDrag(cb) {
      const send = (e: FileDrag) => cb(e)
      const off = getCurrentWebview().onDragDropEvent(async (e) => {
        const p = e.payload
        if (p.type === 'enter') {
          dropped = p.paths
          send({ type: 'enter', dropped: await invoke<Dropped>('inspect_drop', { paths: p.paths }) })
        } else if (p.type === 'over') send({ type: 'over', ...at(p.position) })
        else if (p.type === 'drop') {
          dropped = p.paths
          send({ type: 'drop', ...at(p.position) })
        } else send({ type: 'leave' })
      })
      return () => void off.then((f) => f())
    },
    async importDropped(folder, projects) {
      const r = await invoke<{ items: TauriItem[]; projects: StoredProject[]; skipped: number; failed: string[] }>(
        'import_files',
        { paths: dropped, folder, projects },
      )
      const now = new Date()
      void makeUiThumbs(r.items)
      return {
        items: r.items.map((it) => toItem(it, now, formats, urlsOf(it))),
        projects: r.projects.map((p) => toProject(p, now)),
        skipped: r.skipped,
        failed: r.failed,
      }
    },
    onThumbnail(cb) {
      for (const [id, t] of ready.splice(0)) cb(id, t)
      subs.add(cb)
      return () => subs.delete(cb)
    },
    onChanged(cb) {
      for (const c of changes.splice(0)) cb(c)
      changeSubs.add(cb)
      return () => changeSubs.delete(cb)
    },
    plugins: () => invoke<PluginReport>('plugins'),
    pluginActions: {
      async install() {
        const local = await invoke<string | null>('pick_plugin')
        if (!local) return false
        const source: PluginSource = { local }
        await invoke('install_plugin', { source })
        return true
      },
      update: (id) => invoke('update_plugin', { id }),
      remove: (id) => invoke('remove_plugin', { id }),
      setSetting,
    },
    async itemView(id) {
      if (decoded) URL.revokeObjectURL(decoded)
      decoded = undefined
      const v = await invoke<TauriView | null>('item_view', { id })
      if (!v) return null
      if (v.kind === 'ui') return { kind: 'ui', plugin: v.plugin, url: pluginUrl(v.plugin, v.module) }
      if (v.kind !== 'decoded') return { kind: v.kind }
      const png = await invoke<ArrayBuffer>('item_decoded', { id })
      decoded = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      return { kind: 'image', url: decoded }
    },
    uiApi,
  }
}
