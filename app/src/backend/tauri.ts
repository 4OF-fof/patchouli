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
import type { FormatInfo, ItemView, PluginReport, PluginSource } from '../plugins/types'
import type { Backend, Dropped, FileDrag } from './types'

/** Rust から届く項目。file はファイルの場所、thumb はできているサムネイルの場所。 */
type TauriItem = StoredItem & { file: string; thumb?: string }

const urlsOf = (it: TauriItem): ItemUrls => ({
  src: it.note ? undefined : convertFileSrc(it.file),
  thumb: it.thumb && convertFileSrc(it.thumb),
})

/** Rust から届く、詳細に出すもの。page はプラグインの id と、そのフォルダの中のパス。 */
type TauriView = Exclude<ItemView, { kind: 'page' }> | { kind: 'page'; plugin: string; path: string }

/** プラグインの画面の URL（src-tauri/src/plugin/page.rs が返す）。 */
const pageUrl = (plugin: string, path: string) =>
  convertFileSrc('', 'plugin') + [plugin, ...path.split('/')].map(encodeURIComponent).join('/')

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

  // 落としたもののパスは画面に渡さず、取り込むときまでここで持つ
  let dropped: string[] = []

  return {
    async open() {
      await listenThumbs()
      const s = await invoke<StoredLibrary<TauriItem>>('open_library')
      formats = new Map(s.formats.map((f) => [f.ext, f]))
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
        let source: PluginSource
        if (from === 'folder' || from === 'zip') {
          const local = await invoke<string | null>('pick_plugin', { zip: from === 'zip' })
          if (!local) return false
          source = { local }
        } else source = from
        await invoke('install_plugin', { source })
        return true
      },
      update: (id) => invoke('update_plugin', { id }),
      use: (id) => invoke('use_plugin', { id }),
      remove: (id) => invoke('remove_plugin', { id }),
      setSetting: (id, key, value) => invoke('set_plugin_setting', { id, key, value }),
    },
    async itemView(id) {
      const v = await invoke<TauriView | null>('item_view', { id })
      return v?.kind === 'page' ? { kind: 'page', url: pageUrl(v.plugin, v.path) } : v
    },
    readItem: (id, offset, length) => invoke<ArrayBuffer>('plugin_read', { id, offset, length }),
    callPlugin: (id, method, args) => invoke<string>('plugin_call', { id, method, args }),
  }
}
