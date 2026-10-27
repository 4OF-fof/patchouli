import type { CoverPart, Item, Library, NoteBlock, Project, TagCoverPart, Thumbnail } from '../model/library'
import type { ItemDetails, ItemView, Part, PluginActions, PluginReport, UiRef } from '../plugins/types'
import type { UiApi, UiItem } from '../plugins/ui'

export interface LibraryState {
  pins: string[]
  pinnedProjects: string[]
  pinnedTags: string[]
  tagCovers: Record<string, TagCoverPart[]>
}

export interface ListDiff {
  add?: string[]
  remove?: string[]
}

export interface ItemPatch {
  tags?: ListDiff
  aliases?: ListDiff
  rating?: number
  memo?: string
  blocks?: NoteBlock[]
}

export interface Opened {
  lib: Library
  location?: string
  pinnedProjects: string[]
  pinnedTags: string[]
  problems: string[]
}

export interface Changed {
  items: Item[]
  removed: string[]
  projects?: Project[]
  state?: Partial<LibraryState>
  problems: string[]
}

export interface Dropped {
  files: number
  folders: {
    key: number
    name: string
    files: number
    subfolders: number
  }[]
  loose: number
}

export type FileDrag =
  | { type: 'enter'; dropped: Dropped }
  | { type: 'over'; x: number; y: number }
  | { type: 'drop'; x: number; y: number }
  | { type: 'leave' }

export interface Imported {
  items: Item[]
  projects: Project[]
  skipped: number
  failed: string[]
}

export interface KnownLibrary {
  path: string
  name: string
  opened: number
  exists: boolean
  current: boolean
}

export interface LibraryActions {
  list(): Promise<KnownLibrary[]>
  switch(path: string): Promise<void>
  forget(path: string): Promise<void>
}

export type CacheKind = 'library' | 'thumbs' | 'all'

export interface CacheUsage {
  library: number
  thumbs: number
}

export interface UnusedPlugin {
  id: string
  name: string
  version?: string
  bytes: number
}

export interface TidyActions {
  usage(): Promise<CacheUsage>
  clear(kind: CacheKind): Promise<void>
  unusedPlugins(): Promise<UnusedPlugin[]>
  removeUnusedPlugins(): Promise<void>
}

export interface Developer {
  enabled: boolean
  pluginDirs: string[]
  repos: string[]
}

export interface DeveloperActions {
  get(): Promise<Developer>
  set(d: Developer): Promise<void>
  pick(kind: 'dir' | 'repo'): Promise<string | undefined>
}

export interface PluginWork {
  thumbnails: string[]
  waveforms: string[]
}

export interface Backend {
  open(): Promise<Opened>
  saveItem(id: string, patch: ItemPatch): Promise<Item | undefined>
  moveItem(id: string, folder: string | null): Promise<Item | undefined>
  renameItem(id: string, name: string): Promise<Item | undefined>
  saveState(state: LibraryState): Promise<void>
  createNote(name: string, folder: string | null): Promise<Item>
  createProject(name: string): Promise<Project>
  saveProject(name: string, cover: CoverPart[]): Promise<void>
  chooseLibrary?(): Promise<boolean>
  libraries?: LibraryActions
  tidy?: TidyActions
  developer?: DeveloperActions
  onFileDrag?(cb: (e: FileDrag) => void): () => void
  importDropped?(folder: string | null, projects: number[]): Promise<Imported>
  onThumbnail(cb: (id: string, thumb: Thumbnail) => void): () => void
  onChanged?(cb: (c: Changed) => void): () => void
  plugins(): Promise<PluginReport>
  pluginActions?: PluginActions
  pluginWork?(): Promise<PluginWork>
  stopPluginWork?(part?: 'thumbnail' | 'waveform'): Promise<void>
  checking?(): Promise<boolean>
  reloadPlugins?(wait: boolean): Promise<Opened>
  itemView?: (id: string) => Promise<ItemView | null>
  itemDetails?: (id: string) => Promise<ItemDetails>
  revealItem?: (id: string) => Promise<void>
  openItemDefault?: (id: string) => Promise<void>
  waveform?: (id: string) => Promise<Uint8Array | null>
  uiApi?: (item: UiItem, part: Part, plugin: string) => UiApi
  uiUrl?: (ui: UiRef) => string
}
