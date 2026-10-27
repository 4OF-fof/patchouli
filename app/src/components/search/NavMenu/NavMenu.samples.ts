import type { NavMenuEntry } from './NavMenu'

/** ストーリー用の見本。 */
export const MAIN_ITEMS: NavMenuEntry[] = [
  { id: 'home', icon: 'home', label: 'ホーム', current: true },
  { id: 'projects', icon: 'folder', label: 'プロジェクト', count: 8 },
  { id: 'tags', icon: 'hash', label: 'タグ', count: 14 },
  { id: 'search', icon: 'search', label: '検索', kbd: 'Ctrl P' },
  'separator',
  { id: 'settings', icon: 'settings', label: '設定' },
]

export const SETTINGS_ITEMS: NavMenuEntry[] = [
  { id: 'back', icon: 'back', label: '設定', heading: true },
  'separator',
  { id: 'library', icon: 'library', label: 'ライブラリを切り替え', hint: 'dev-library' },
  { id: 'theme', icon: 'theme', label: 'テーマを切り替え' },
  { id: 'keys', icon: 'keyboard', label: 'ショートカット一覧', kbd: '?' },
]
