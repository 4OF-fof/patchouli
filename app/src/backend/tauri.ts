/* デスクトップ（Tauri）の窓口。ファイルの読み書きとサムネイル作りは Rust 側（src-tauri/src/）がする。 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  type ItemUrls,
  type StoredItem,
  type StoredLibrary,
  type StoredProject,
  toItem,
  toOpened,
  toProject,
} from './stored'
import type { Backend } from './types'

/** Rust から届く項目。file はファイルの場所、thumb はできているサムネイルの場所。 */
type TauriItem = StoredItem & { file: string; thumb?: string }

const urlsOf = (it: TauriItem): ItemUrls => ({
  src: it.kind === 'note' ? undefined : convertFileSrc(it.file),
  thumb: it.thumb && convertFileSrc(it.thumb),
})

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
    onThumbnail(cb) {
      for (const [id, url] of ready.splice(0)) cb(id, url)
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}
