import type { NavMenuEntry } from './NavMenu'

export const MAIN_ITEMS: NavMenuEntry[] = [
  { id: 'search', icon: 'search', label: '検索', kbd: 'Ctrl P' },
  { id: 'settings', icon: 'settings', label: '設定' },
]

export const PLACE_ITEMS: NavMenuEntry[] = [
  { id: 'home', icon: 'home', label: 'ホーム' },
  { id: 'projects', icon: 'folder', label: 'プロジェクト', count: 8, current: true },
  { id: 'tags', icon: 'hash', label: 'タグ', count: 14 },
]

export const SETTINGS_ITEMS: NavMenuEntry[] = [
  { id: 'back', icon: 'back', label: '設定', heading: true },
  'separator',
  { id: 'library', icon: 'library', label: 'ライブラリを切り替え', hint: 'dev-library' },
  { id: 'theme', icon: 'theme', label: 'テーマを切り替え' },
  { id: 'keys', icon: 'keyboard', label: 'ショートカット一覧', kbd: '?' },
]
