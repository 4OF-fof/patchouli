/*
 * プラグインの画面だけを出す別のウィンドウと、本体の窓のやり取り。ライブラリは本体の窓だけが持ち、
 * ウィンドウは項目の写しを受け取って描き、書き換えや移動は本体の窓に頼む。
 */
import type { LibraryItem, NewNote, OpenOptions, SettingValue } from '../../plugins/sdk'

export const SCREEN_WINDOW = 'screen-'

/** 本体の窓 → ウィンドウ。描くもの。届くたびに画面を描き直す。 */
export const STATE = 'screen-window-state'
/** 本体の窓 → ウィンドウ。項目が変わったとき。 */
export const ITEMS = 'screen-window-items'
/** 本体の窓 → ウィンドウ。頼まれたことの結果。 */
export const REPLY = 'screen-window-reply'
/** ウィンドウ → 本体の窓。 */
export const FROM_WINDOW = 'screen-window'

export interface WindowState {
  plugin: string
  screen: string
  label: string
  /** elevated の URL。 */
  url: string
  items: LibraryItem[]
  targets: string[]
}

export type WindowCall =
  | { method: 'settings'; args: [] }
  | { method: 'getData'; args: [string] }
  | { method: 'setSetting'; args: [string, SettingValue] }
  /** JSON にして送るので、消すときの undefined は null で届く。 */
  | { method: 'setData'; args: [string, string | null] }
  | { method: 'open' | 'openTag' | 'openProject'; args: [string, OpenOptions?] }
  | { method: 'createNote'; args: [NewNote] }
  | { method: 'setBody' | 'rename'; args: [string, string] }
  | { method: 'setTags'; args: [string, string[]] }

export type FromWindow = { label: string } & (
  | { kind: 'ready' }
  | { kind: 'closed' }
  | ({ kind: 'call'; req: number } & WindowCall)
)

/** 頼まれたことの結果。返すものがあれば、頼みに合わせてどれか 1 つに入れる。 */
export interface Reply {
  req: number
  error?: string
  settings?: Record<string, SettingValue>
  data?: string
  item?: LibraryItem
}
