/*
 * 画面からライブラリを読み書きする窓口。デスクトップ（Tauri）と web（同期サーバー）の違いはこの裏に隠し、
 * 画面はファイルの場所や形式を知らない。
 */
import type { CoverPart, Item, Library, NoteBlock, Project, TagCoverPart } from '../model/library'

/** ライブラリ全体にかかわる状態。 */
export interface LibraryState {
  /** ピン留めした項目の id（留めた順）。 */
  pins: string[]
  /** ホームにピン留めしたプロジェクトの名前とタグ。 */
  pinnedProjects: string[]
  pinnedTags: string[]
  tagCovers: Record<string, TagCoverPart[]>
}

/** 項目の保存する属性。書いたものだけを変える。 */
export interface ItemPatch {
  tags?: string[]
  aliases?: string[]
  rating?: number
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

export interface Backend {
  open(): Promise<Opened>
  saveItem(id: string, patch: ItemPatch): Promise<void>
  saveState(state: LibraryState): Promise<void>
  /** folder が null のときは、どこにも入れない。 */
  createNote(name: string, folder: string | null): Promise<Item>
  createProject(name: string): Promise<Project>
  saveProject(name: string, cover: CoverPart[]): Promise<void>
  /** 次から開くライブラリを選ぶ。選べない環境にはない。選ばなかったときは false。 */
  chooseLibrary?(): Promise<boolean>
  /** ファイルを持ってきたときに呼ぶ。受け付けない環境にはない。返す関数で止める。 */
  onFileDrag?(cb: (e: FileDrag) => void): () => void
  /** 最後に落としたものを取り込む。folder が null のときは、どこにも入れない。projects に key があるフォルダは、新しいプロジェクトにする。 */
  importDropped?(folder: string | null, projects: number[]): Promise<Imported>
  /** サムネイルができるたびに呼ぶ。開く前にできたものも、登録したときにまとめて渡す。返す関数で止める。 */
  onThumbnail(cb: (id: string, url: string) => void): () => void
}
