/*
 * 画面からライブラリを読み書きする窓口。デスクトップ（Tauri）と web（同期サーバー）の違いはこの裏に隠し、
 * 画面はファイルの場所や形式を知らない。
 */
import type { CoverPart, Item, Library, NoteBlock, Project, TagCoverPart, Thumbnail } from '../model/library'
import type { ItemView, Part, PluginActions, PluginReport, UiRef } from '../plugins/types'
import type { UiApi, UiItem } from '../plugins/ui'

/** ライブラリ全体にかかわる状態。 */
export interface LibraryState {
  /** ピン留めした項目の id（留めた順）。 */
  pins: string[]
  /** ホームにピン留めしたプロジェクトの名前とタグ。 */
  pinnedProjects: string[]
  pinnedTags: string[]
  tagCovers: Record<string, TagCoverPart[]>
}

/** 一覧（タグ・別名）の変え方。保存するときに、ファイルのいまの中身に当てる。 */
export interface ListDiff {
  add?: string[]
  remove?: string[]
}

/** 項目の保存する属性。書いたものだけを変える。 */
export interface ItemPatch {
  tags?: ListDiff
  aliases?: ListDiff
  rating?: number
  /** memo と blocks は、最後に読んだあとにファイルが外で変わっていれば書かない（saveItem）。 */
  memo?: string
  blocks?: NoteBlock[]
}

export interface Opened {
  lib: Library
  /** 開いたライブラリの場所（表示用）。開けなかったときはない。 */
  location?: string
  pinnedProjects: string[]
  pinnedTags: string[]
  /** 読めなかったもの。 */
  problems: string[]
}

/** 開いたあとにファイルと突き合わせて見つかった違い。 */
export interface Changed {
  /** 足されたものと変わったもの。 */
  items: Item[]
  /** なくなったものの id。 */
  removed: string[]
  /** 変わったときだけある。 */
  projects?: Project[]
  state?: Partial<LibraryState>
  /** 読めなかったもの。 */
  problems: string[]
}

/** 落とそうとしているものの中身。 */
export interface Dropped {
  /** 取り込めるファイルの数（フォルダの中も数える）。 */
  files: number
  folders: {
    /** 取り込むときに、プロジェクトにするフォルダをこれで指す。 */
    key: number
    name: string
    /** 中の取り込めるファイルの数（下の階層も数える）。 */
    files: number
    subfolders: number
  }[]
  /** フォルダに入っていないファイルの数。 */
  loose: number
}

/** ファイルを画面の上に持ってきたときの動き。x と y は画面の中の位置（CSS の px）。 */
export type FileDrag =
  | { type: 'enter'; dropped: Dropped }
  | { type: 'over'; x: number; y: number }
  | { type: 'drop'; x: number; y: number }
  | { type: 'leave' }

export interface Imported {
  items: Item[]
  projects: Project[]
  /** 取り込まなかったファイルの数（取り込めない形式、ライブラリの中にあるもの）。 */
  skipped: number
  /** コピーできなかったもの。 */
  failed: string[]
}

/** 開いたことのあるライブラリ。 */
export interface KnownLibrary {
  path: string
  /** フォルダの名前。 */
  name: string
  /** 最後に開いた日時（UNIX ミリ秒）。 */
  opened: number
  /** いまその場所にある。 */
  exists: boolean
  /** いま開いている。 */
  current: boolean
}

/** 開いたことのあるライブラリの操作。開くライブラリが変わったら、open からやり直す。 */
export interface LibraryActions {
  /** 最後に開いた順。 */
  list(): Promise<KnownLibrary[]>
  /** path を次から開くライブラリにする。 */
  switch(path: string): Promise<void>
  /** 一覧から外す。 */
  forget(path: string): Promise<void>
}

/** キャッシュの種類。library はライブラリの写し。 */
export type CacheKind = 'library' | 'thumbs' | 'all'

/** キャッシュの使っている量（バイト）。 */
export interface CacheUsage {
  library: number
  thumbs: number
}

/** どのライブラリでも使っていないプラグイン。 */
export interface UnusedPlugin {
  id: string
  name: string
  version?: string
  bytes: number
}

/** キャッシュと使っていないプラグインの片付け。 */
export interface TidyActions {
  /** 開いているライブラリの分。 */
  usage(): Promise<CacheUsage>
  /** 開いているライブラリの分を消す。そのライブラリを閉じるので、open からやり直す。 */
  clear(kind: CacheKind): Promise<void>
  unusedPlugins(): Promise<UnusedPlugin[]>
  removeUnusedPlugins(): Promise<void>
}

/**
 * 開発者モード。場所はオフのあいだも残す。
 * pluginDirs は中の `<名前>/plugin.json` を開発版として読むフォルダ、repos は plugin.json を直下に持つリポジトリ（ビルドした `<id>-<版>.zip` を読む）。
 */
export interface Developer {
  enabled: boolean
  pluginDirs: string[]
  repos: string[]
}

/** 開発者モードの設定。 */
export interface DeveloperActions {
  get(): Promise<Developer>
  /** 変えたものは、再起動すると使う。 */
  set(d: Developer): Promise<void>
  /** 場所を選ぶ窓を出す。repo ならリポジトリ、でなければフォルダ。選ばなかったときは undefined。 */
  pick(kind: 'dir' | 'repo'): Promise<string | undefined>
  restart(): Promise<void>
}

export interface Backend {
  open(): Promise<Opened>
  /** 文章がファイルの外での変更と食い違って書かなかったときは、読み直した項目を返す。 */
  saveItem(id: string, patch: ItemPatch): Promise<Item | undefined>
  /** 項目のファイルをプロジェクト folder（null はどこにも入れない）へ移し、移したあとの項目を返す。ファイルのない環境では返さない。 */
  moveItem(id: string, folder: string | null): Promise<Item | undefined>
  saveState(state: LibraryState): Promise<void>
  /** folder が null のときは、どこにも入れない。 */
  createNote(name: string, folder: string | null): Promise<Item>
  createProject(name: string): Promise<Project>
  saveProject(name: string, cover: CoverPart[]): Promise<void>
  /** 次から開くライブラリを選ぶ。選べない環境にはない。選ばなかったときは false。 */
  chooseLibrary?(): Promise<boolean>
  /** 開いたことのあるライブラリ。覚えない環境にはない。 */
  libraries?: LibraryActions
  /** キャッシュと使っていないプラグインの片付け。できない環境にはない。 */
  tidy?: TidyActions
  /** 開発者モード。できない環境にはない。 */
  developer?: DeveloperActions
  /** ファイルを持ってきたときに呼ぶ。受け付けない環境にはない。返す関数で止める。 */
  onFileDrag?(cb: (e: FileDrag) => void): () => void
  /** 最後に落としたものを取り込む。folder が null のときは、どこにも入れない。projects に key があるフォルダは、新しいプロジェクトにする。 */
  importDropped?(folder: string | null, projects: number[]): Promise<Imported>
  /** サムネイルができるたびに呼ぶ。開く前にできたものも、登録したときにまとめて渡す。返す関数で止める。 */
  onThumbnail(cb: (id: string, thumb: Thumbnail) => void): () => void
  /** 前に開いたときの写しから開いた環境で、裏でファイルと突き合わせて違いがわかったら呼ぶ。開く前に届いたものも、登録したときに渡す。返す関数で止める。 */
  onChanged?(cb: (c: Changed) => void): () => void
  /** プラグインの一覧と、それぞれの問題。 */
  plugins(): Promise<PluginReport>
  /** プラグインを入れる・外すなどの操作。できない環境にはない。使うプラグインが変わったら、open からやり直す。 */
  pluginActions?: PluginActions
  /** 素材の詳細に出すもの。受け持つプラグインが決める。決まらなければ null。 */
  itemView?: (id: string) => Promise<ItemView | null>
  /** 音声の素材に残してある波形（区間ごとの音の大きさを、0〜255 にしたもの）。まだなければ null。 */
  waveform?: (id: string) => Promise<Uint8Array | null>
  /** 素材 item の part を受け持つ組み込み UI（plugin）に渡す窓口。 */
  uiApi?: (item: UiItem, part: Part, plugin: string) => UiApi
  /** 組み込み UI の ES モジュールの URL。 */
  uiUrl?: (ui: UiRef) => string
}
