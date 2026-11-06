import type { Permission, PluginSource } from './types'

export const PERMISSION: Record<Permission, string> = {
  library: 'ライブラリの情報を読み取り',
  clipboard: 'クリップボードにコピー',
  notes: 'ノートを作成・編集',
  edit: '名前とタグを変更',
  assets: '素材を登録・置き換え',
  export: 'ファイルを書き出し',
  embed: '文章を AI で解析',
}

export const FULL_ACCESS = {
  label: 'フルアクセス',
  text: 'アプリの画面上で直接動作し、すべての機能にアクセス可能',
}

export const sourceLabel = (s: PluginSource) => ('github' in s ? `github.com/${s.github}` : s.local)
