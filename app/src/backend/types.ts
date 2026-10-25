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
  /** サムネイルができるたびに呼ぶ。開く前にできたものも、登録したときにまとめて渡す。返す関数で止める。 */
  onThumbnail(cb: (id: string, url: string) => void): () => void
}
