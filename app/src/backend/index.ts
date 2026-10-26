import { isTauri } from '@tauri-apps/api/core'
import { sampleBackend } from './sample'
import { tauriBackend } from './tauri'
import type { Backend } from './types'

export type { Backend, Changed, Dropped, FileDrag, Imported, ItemPatch, LibraryState, ListDiff, Opened } from './types'
export { sampleBackend } from './sample'

/** 動いている場所に合った窓口。web の同期サーバーはまだないので、Tauri の外では見本を開く。 */
export const pickBackend = (): Backend => (isTauri() ? tauriBackend() : sampleBackend())
