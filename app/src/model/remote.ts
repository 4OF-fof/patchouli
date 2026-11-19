import type { RemotePermission } from '../backend/types'

/** 並びは src-tauri/src/remote/proto.rs の PERMISSIONS と合わせる。 */
export const REMOTE_PERMISSIONS: { id: RemotePermission; label: string }[] = [
  { id: 'library', label: 'ライブラリの情報を読み取り' },
  { id: 'assets', label: '素材を追加' },
  { id: 'notes', label: 'ノートを作成・編集' },
  { id: 'edit', label: '名前・タグ・プロジェクトを変更' },
  { id: 'delete', label: 'ごみ箱に移動' },
  { id: 'window', label: 'ウィンドウを表示・アプリを終了' },
]
