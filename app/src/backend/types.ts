import type {
  CoverPart,
  Group,
  Item,
  Library,
  Place,
  Project,
  Suggestion,
  TagCoverPart,
  Thumbnail,
} from '../model/library'
import type {
  ItemDetails,
  ItemView,
  LinkPart,
  MenuGroup,
  MenuOutput,
  CapPart,
  PluginActions,
  PluginReport,
  ScreenInfo,
  UiRef,
} from '../plugins/types'
import type { LinkApi, OwnApi } from '../../plugins/sdk'
import type { Page } from '../plugins/links'
import type { UiApi, UiItem } from '../plugins/ui'
import type { FromWindow } from '../window/protocol'

export interface LibraryState {
  pins: string[]
  pinnedProjects: string[]
  pinnedTags: string[]
}

/** タブごとの、いまの場所までの画面の並び。中身はファイルから読むので、確かめてから使う。 */
export interface SavedTabs {
  tabs: unknown[][]
  current: number
  /** 分割して並べるまとまり。葉はタブの並びの index。 */
  splits?: unknown[]
}

export interface ListDiff {
  add?: string[]
  remove?: string[]
}

export interface ItemPatch {
  tags?: ListDiff
  aliases?: ListDiff
  memo?: string
  body?: string
}

/** 本体が見つからない .meta。 */
export interface Orphan {
  meta: string
  name: string
  /** ある場所。ライブラリからのフォルダの並びを / でつないだもの */
  place: string | null
  kind: 'asset' | 'project' | 'group'
  /** つなぎ直せる先の名前。素材なら同じフォルダのタグもメモもない素材、グループなら種類のないグループ */
  candidates: string[]
}

export interface Opened {
  lib: Library
  location?: string
  pinnedProjects: string[]
  pinnedTags: string[]
  orphans?: Orphan[]
  /** プラグインが足す画面。 */
  screens?: ScreenInfo[]
  problems: string[]
}

export interface Changed {
  items: Item[]
  removed: string[]
  projects?: Project[]
  groups?: Group[]
  state?: Partial<LibraryState>
  tagCovers?: Map<string, TagCoverPart[]>
  orphans?: Orphan[]
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
  | { type: 'drop'; x: number; y: number; dropped: Dropped }
  | { type: 'leave' }

export interface Imported {
  items: Item[]
  groups: Group[]
  skipped: number
  failed: string[]
}

/** 右クリックメニューの項目を実行したあと。copy は写すもの、items はプラグインが作ったノートと登録した素材。 */
export interface MenuResult {
  output?: MenuOutput
  copy?: string
  items: Item[]
  /** 書き出した先。 */
  saved?: string
  failed: string[]
}

/** 取り込みのフックが失敗したこと。 */
export interface HookFailed {
  plugin: string
  item: string
  message: string
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

/** 本体の設定。 */
export interface AppSettings {
  /** ライブラリの外から落としたファイルを、コピーするか移動するか */
  importMode: 'copy' | 'move'
  /** サムネイルの長いほうの辺。standard は 512px、large は 1024px */
  thumbSize: 'standard' | 'large'
  /** 外部ツールの名前 → 指定した場所。書いていないものは PATH から探す */
  commandPaths: Record<string, string>
  /** ノートのリンクの URL を、内蔵ブラウザ（タブ）で開くか、既定のアプリで開くか */
  linkOpen: 'builtin' | 'default'
}

export interface AppSettingsActions {
  get(): Promise<AppSettings>
  /** サムネイルの大きさを変えたときは、サムネイルのキャッシュを消す。 */
  set(s: AppSettings): Promise<void>
  pickCommand(name: string): Promise<string | undefined>
}

/** タグの候補の扱い。auto は選択済みの候補をそのまま付け、confirm は分類の確認に出す。 */
export type TagSuggest = 'auto' | 'confirm' | 'off'

export interface AutoTag {
  enabled: boolean
  installed: boolean
  downloading: boolean
  /** これからダウンロードする大きさ（バイト） */
  need: number
  /** llama-server が使える GPU。空なら CPU で動かす。インストールする前は undefined */
  gpus?: string[]
  suggest: TagSuggest
  /** AI 検索を使うか */
  search: boolean
}

export interface AutoTagProgress {
  file: string
  done: number
  total: number
}

export interface AutoTagActions {
  get(): Promise<AutoTag>
  /** 有効にするときは、ダウンロードし終えるまで待つ。 */
  set(on: boolean): Promise<void>
  cancelDownload(): Promise<void>
  setSuggest(mode: TagSuggest): Promise<void>
  setSearch(on: boolean): Promise<void>
  onProgress(cb: (p: AutoTagProgress) => void): () => void
}

export interface ContentHit {
  id: string
  score: number
  /** 当たった区間の始まり（秒） */
  at?: number
}

export interface ContentSearch {
  /** llama-server が起動し終えるまで待つ。 */
  prepare(): Promise<void>
  search(query: string): Promise<ContentHit[]>
}

export interface Suggestions {
  /** 選択済みの候補を、確認せずにそのまま付ける */
  apply: boolean
  items: Record<string, Suggestion>
}

export interface TagDecisions {
  /** 分類の確認で承認した item の判断を残す。chosen は付けたタグ、rejected は外した候補。 */
  record(item: string, chosen: string[], rejected: string[]): Promise<void>
  /** item の判断を取り消す。 */
  undo(item: string): Promise<void>
  /** タグを付ける欄に出す候補。 */
  suggestTags: (id: string) => Promise<string[]>
  /** タグのない項目の候補を作り直すたびに呼ぶ。 */
  onSuggestions(cb: (s: Suggestions) => void): () => void
}

export interface PluginWork {
  thumbnails: string[]
  waveforms: string[]
  /** 取り込みのフックを待っているもの。 */
  hooks: string[]
}

export interface Backend {
  open(): Promise<Opened>
  saveItem(id: string, patch: ItemPatch): Promise<Item | undefined>
  moveItem(id: string, place: Place): Promise<Item | undefined>
  renameItem(id: string, name: string): Promise<Item | undefined>
  /** ファイルとメタ情報をごみ箱に移動する。 */
  deleteItem?: (id: string) => Promise<void>
  saveState(state: LibraryState): Promise<void>
  /** 最近付けたタグ。新しい順。 */
  tagHistory?: () => Promise<string[]>
  saveTagHistory?: (tags: string[]) => Promise<void>
  /** 最近開いた項目の ID。新しい順。 */
  openHistory?: () => Promise<string[]>
  saveOpenHistory?: (ids: string[]) => Promise<void>
  /** 前に開いていたタブ。 */
  tabs?: () => Promise<SavedTabs | undefined>
  saveTabs?: (tabs: SavedTabs) => Promise<void>
  createNote(name: string, place: Place): Promise<Item>
  createProject(name: string): Promise<Project>
  saveProject(name: string, cover: CoverPart[]): Promise<void>
  /** フォルダの名前を変える。中の項目は、あとで onChanged で届く。 */
  renameProject?: (from: string, to: string) => Promise<void>
  /** 中身をルートの直下に移し、フォルダと概要をごみ箱に移す。中の項目は、あとで onChanged で届く。 */
  deleteProject?: (name: string) => Promise<void>
  saveTagCover(tag: string, cover: TagCoverPart[]): Promise<void>
  /**
   * 下の階層のタグも合わせて付け替える。素材に付いたタグは saveItem で直す。
   * 変えた先がすでにあれば、keepFrom のときは元の概要を、そうでなければ変えた先の概要を残す。
   */
  renameTag(from: string, to: string, keepFrom: boolean): Promise<void>
  /** タグの概要をごみ箱に移す。 */
  deleteTagCover(tag: string): Promise<void>
  relinkMeta?: (meta: string, to: string) => Promise<void>
  /** .meta をごみ箱に移す。プロジェクトなら、概要のカードも合わせて移す。 */
  discardMeta?: (meta: string) => Promise<void>
  chooseLibrary?(): Promise<boolean>
  libraries?: LibraryActions
  tidy?: TidyActions
  developer?: DeveloperActions
  appSettings?: AppSettingsActions
  autoTag?: AutoTagActions
  contentSearch?: ContentSearch
  tagDecisions?: TagDecisions
  onFileDrag?(cb: (e: FileDrag) => void): () => void
  /** フォルダは、中のフォルダも含めてグループとして取り込む。 */
  importDropped?(place: Place): Promise<Imported>
  importData?: (file: File, place: Place) => Promise<Item>
  onThumbnail(cb: (id: string, thumb: Thumbnail) => void): () => void
  onChanged?(cb: (c: Changed) => void): () => void
  plugins(): Promise<PluginReport>
  pluginActions?: PluginActions
  pluginWork?(): Promise<PluginWork>
  stopPluginWork?(part?: 'thumbnail' | 'waveform' | 'hook'): Promise<void>
  onHookFailed?(fn: (f: HookFailed) => void): () => void
  /** 画面に見えている作成待ちの項目。サムネイルをこれから先に作る。 */
  seenThumbs?(ids: string[]): void
  checking?(): Promise<boolean>
  reloadPlugins?(wait: boolean): Promise<Opened>
  /** image の url が blob のときは、使い終わったら呼び出し元で revoke する。 */
  itemView?: (id: string) => Promise<ItemView | null>
  itemDetails?: (id: string) => Promise<ItemDetails>
  revealItem?: (id: string) => Promise<void>
  openItemDefault?: (id: string) => Promise<void>
  itemPath?: (id: string) => Promise<string>
  /** プラグインが右クリックメニューに足す項目。ids は選んでいるものすべて。項目のないプラグインは含めない。 */
  itemMenu?: (ids: string[]) => Promise<MenuGroup[]>
  /** プラグインの項目を選んだとき。 */
  runItemMenu?: (ids: string[], plugin: string, entry: string) => Promise<MenuResult>
  waveform?: (id: string) => Promise<Uint8Array | null>
  uiApi?: (item: UiItem, part: CapPart, plugin: string) => UiApi
  /** プラグインの、自分の設定と残した値の窓口。 */
  ownApi?: (plugin: string) => OwnApi
  uiUrl?: (ui: UiRef) => string
  /** url の part を受け持つもの。 */
  linkOf?: (url: string, part: LinkPart) => LinkShown
  /** URL の素材と同じ作り方のサムネイル（blob の URL）。作れなければ undefined。使い終わったら呼び出し元で revoke する。 */
  linkThumb?: (url: string) => Promise<string | undefined>
  /** URL を既定のアプリで開く。 */
  openUrl?: (url: string) => Promise<void>
  /** タブの中に出す外のページ。ないときは iframe で出す。 */
  browser?: BrowserActions
  /** プラグインの画面だけを出す別のウィンドウ。ないときは、タブで開く。 */
  screenWindows?: ScreenWindows
}

export interface ScreenWindows {
  /** 同じ画面のウィンドウがあれば前に出し、existed を true にする。 */
  open(screen: ScreenInfo): Promise<{ label: string; existed: boolean }>
  send(label: string, event: string, payload: unknown): Promise<void>
  /** ウィンドウからの知らせを受ける。返した関数で受けるのをやめる。 */
  listen(fn: (m: FromWindow) => void): () => void
  /** 本体の窓を前に出す。 */
  focusMain(): void
}

/** URL の表示。ui があれば links のプラグインが描き、なければ本体が page（OGP）から作る。 */
export interface LinkShown {
  url: string
  ui?: { url: string; api: LinkApi }
  page: () => Promise<Page>
}

/** 外のページの位置と大きさ（CSS の px）。 */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserActions {
  /** key の外のページを bounds に出す。url が前と違えば開き直す。 */
  show(key: string, url: string, bounds: Bounds): Promise<void>
  go(key: string, to: 'back' | 'forward' | 'reload'): Promise<void>
  hide(key: string): Promise<void>
  close(key: string): Promise<void>
  /** 本体の画面のうち、外のページを見せる穴と、その上に重ねる表示を、描く順に伝える。 */
  layer(layers: PageLayer[]): Promise<void>
  /** 外のページの中で別のページを開いたら、その URL と戻れるか・進めるかを知らせる。戻り値で知らせをやめる。 */
  onMoved(fn: (key: string, at: PageAt) => void): () => void
  /** 外のページが新しいウィンドウで URL を開こうとしたら知らせる。ウィンドウは開かない。戻り値で知らせをやめる。 */
  onPopup(fn: (key: string, url: string) => void): () => void
}

export interface PageLayer extends Bounds {
  /** 外のページを見せる穴か、穴の上に重ねる表示か */
  hole: boolean
  radius: number
}

export interface PageAt {
  url: string
  back: boolean
  forward: boolean
}
