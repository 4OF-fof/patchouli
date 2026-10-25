/* デスクトップ（Tauri）の窓口。ファイルの読み書きとサムネイル作りは Rust 側（src-tauri/src/）がする。 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  type ItemUrls,
  type StoredItem,
  type StoredLibrary,
  type StoredProject,
  toItem,
  toOpened,
  toProject,
} from './stored'
import type { Thumbnail } from '../model/library'
import type { FormatInfo, Part, PluginReport, PluginSource } from '../plugins/types'
import { type UiApi, type UiItem, uiThumbnail } from '../plugins/ui'
import type { Backend, Dropped, FileDrag } from './types'

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

const uiApi = (item: UiItem, part: Part, plugin: string): UiApi => ({
  item,
  read: (offset, length) => invoke<ArrayBuffer>('plugin_read', { id: item.id, offset, length }),
  call: (method, args) => invoke<string>('plugin_call', { id: item.id, part, method, args }),
  settings: () => invoke('plugin_settings', { plugin }),
  setSetting: (key, value) => invoke('set_plugin_setting', { id: plugin, key, value }),
})

const uiItemOf = (it: TauriItem): UiItem => ({ id: it.id, name: it.name, ext: it.ext, url: convertFileSrc(it.file) })

/** 画面の位置（物理 px）を CSS の px にする。 */
const at = (p: { x: number; y: number }) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio })

export function tauriBackend(): Backend {
  // 開いた直後からサムネイルが届くので、画面が受け取れるようになるまで溜めておく
  const ready: [string, Thumbnail][] = []
  const subs = new Set<(id: string, thumb: Thumbnail) => void>()
  let listening: Promise<unknown> | undefined
  const listenThumbs = () =>
    (listening ??= listen<{ id: string; file: string; width: number; height: number }>('thumbnail', (e) => {
      const p = e.payload
      const t = { url: convertFileSrc(p.file), ratio: p.width / p.height }
      if (subs.size) for (const cb of subs) cb(p.id, t)
      else ready.push([p.id, t])
    }))
  // 開いたライブラリで扱える形式。あとから足す項目にも使う
  let formats = new Map<string, FormatInfo>()

  // WASM が PNG にした詳細の画像。次の素材を開くときに捨てる
  let decoded: string | undefined

  // 落としたもののパスは画面に渡さず、取り込むときまでここで持つ
  let dropped: string[] = []

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
          const t = await uiThumbnail(pluginUrl(ui.plugin, ui.module), uiApi(uiItemOf(it), 'thumbnail', ui.plugin))
          if (!t) continue
          const headers: Record<string, string> = { id: it.id }
          if (t.width && t.height) Object.assign(headers, { width: `${t.width}`, height: `${t.height}` })
          await invoke('put_thumbnail', t.png, { headers })
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
      await listenThumbs()
      const s = await invoke<StoredLibrary<TauriItem>>('open_library')
      formats = new Map(s.formats.map((f) => [f.ext, f]))
      void makeUiThumbs(s.items.toSorted((a, b) => b.mtime - a.mtime))
      return toOpened(s, new Date(), urlsOf)
    },
    saveItem: (id, patch) => invoke('save_item', { id, patch }),
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
    plugins: () => invoke<PluginReport>('plugins'),
    pluginActions: {
      async install(from) {
        const local = await invoke<string | null>('pick_plugin', { zip: from === 'zip' })
        if (!local) return false
        const source: PluginSource = { local }
        await invoke('install_plugin', { source })
        return true
      },
      update: (id) => invoke('update_plugin', { id }),
      use: (id) => invoke('use_plugin', { id }),
      remove: (id) => invoke('remove_plugin', { id }),
      setSetting: (id, key, value) => invoke('set_plugin_setting', { id, key, value }),
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
