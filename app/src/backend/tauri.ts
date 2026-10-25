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
import type { Backend, Dropped, FileDrag } from './types'

/** Rust から届く項目。file はファイルの場所、thumb はできているサムネイルの場所。 */
type TauriItem = StoredItem & { file: string; thumb?: string }

const urlsOf = (it: TauriItem): ItemUrls => ({
  src: it.kind === 'note' ? undefined : convertFileSrc(it.file),
  thumb: it.thumb && convertFileSrc(it.thumb),
})

/** 画面の位置（物理 px）を CSS の px にする。 */
const at = (p: { x: number; y: number }) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio })

export function tauriBackend(): Backend {
  // 開いた直後からサムネイルが届くので、画面が受け取れるようになるまで溜めておく
  const ready: [string, string][] = []
  const subs = new Set<(id: string, url: string) => void>()
  let listening: Promise<unknown> | undefined
  const listenThumbs = () =>
    (listening ??= listen<{ id: string; file: string }>('thumbnail', (e) => {
      const url = convertFileSrc(e.payload.file)
      if (subs.size) for (const cb of subs) cb(e.payload.id, url)
      else ready.push([e.payload.id, url])
    }))

  // 落としたもののパスは画面に渡さず、取り込むときまでここで持つ
  let dropped: string[] = []

  return {
    async open() {
      await listenThumbs()
      return toOpened(await invoke<StoredLibrary<TauriItem>>('open_library'), new Date(), urlsOf)
    },
    saveItem: (id, patch) => invoke('save_item', { id, patch }),
    saveState: (state) => invoke('save_state', { state }),
    async createNote(name, folder) {
      const it = await invoke<TauriItem>('create_note', { name, folder })
      return toItem(it, new Date(), urlsOf(it))
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
        items: r.items.map((it) => toItem(it, now, urlsOf(it))),
        projects: r.projects.map((p) => toProject(p, now)),
        skipped: r.skipped,
        failed: r.failed,
      }
    },
    onThumbnail(cb) {
      for (const [id, url] of ready.splice(0)) cb(id, url)
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}
