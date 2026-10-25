import type { NavMenuEntry } from './NavMenu'

/** ストーリー用の見本。 */
export const MAIN_ITEMS: NavMenuEntry[] = [
  { id: 'home', icon: '⌂', label: 'ホーム', current: true },
  { id: 'tags', icon: '#', label: 'タグ一覧', count: 14 },
  { id: 'projects', icon: '▦', label: 'プロジェクト一覧', count: 8 },
  'separator',
  { id: 'settings', icon: '⚙', label: '設定' },
]

export const SETTINGS_ITEMS: NavMenuEntry[] = [
  { id: 'back', icon: '‹', label: '設定', heading: true },
  'separator',
  { id: 'theme', icon: '◐', label: 'テーマを切り替える' },
  { id: 'keys', icon: '⌨', label: 'キー操作の一覧', kbd: '?' },
]
