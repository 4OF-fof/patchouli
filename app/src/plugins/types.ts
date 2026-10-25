/* プラグインの形。plugin.json と、Rust 側（src-tauri/src/plugin/）から届くもの。Rust 側と合わせる。 */

/** 形式ごとに受け持つもの。どれも WASM で受け持つ。 */
export type Part = 'thumbnail' | 'view'

/** FFmpeg をどれだけ要るか。 */
export type Need = 'none' | 'optional' | 'required'

export interface FormatDecl {
  /** 引き継ぐ形式。自分で受け持たないものと、書いていない呼び名などはそちらのものを使う。 */
  extends?: string
  label?: string
  /** 縦横比（幅 / 高さ）の既定。サムネイルができるまで使う。 */
  ratio?: number
  parts?: Part[]
}

/** plugin.json。 */
export interface Manifest {
  id: string
  name: string
  version: string
  description?: string
  ffmpeg?: Need
  formats: Record<string, FormatDecl>
}

/** 引き継ぎをたどったあとの形式。 */
export interface FormatInfo {
  ext: string
  label: string
  ratio: number
  /** 受け持つプラグインの id。 */
  plugin: string
  /** サムネイルを作れる。 */
  thumbnail: boolean
}

export interface Problem {
  level: 'error' | 'warning'
  text: string
}

/** プラグインの取得先。github は owner/name、local は手元のフォルダか zip。 */
export type PluginSource = { github: string } | { local: string }

export type SettingValue = boolean | number | string

/** プラグインが返した設定の項目。value はいまの値。 */
export type Setting = {
  key: string
  label: string
  help?: string
  default: SettingValue
  value: SettingValue
} & (
  | { kind: 'toggle' }
  | { kind: 'number'; min?: number | null; max?: number | null; step?: number | null }
  | { kind: 'text' }
  | { kind: 'choice'; choices: { value: string; label: string }[] }
)

/** active 使っている / missing ライブラリに記録してあるがアプリに入っていない / unused アプリに入っているがこのライブラリでは使っていない */
export type PluginState = 'active' | 'missing' | 'unused'

export interface PluginStatus {
  id: string
  name: string
  /** アプリに入っている版。 */
  version?: string
  /** ライブラリに記録した版。 */
  recorded?: string
  source?: PluginSource
  description: string
  builtin: boolean
  state: PluginState
  ffmpeg: Need
  /** 受け持っている形式。 */
  formats: string[]
  settings: Setting[]
  problems: Problem[]
}

export interface PluginReport {
  plugins: PluginStatus[]
  /** 見つけた FFmpeg。null は見つからない、ないときは FFmpeg を探さない環境。 */
  ffmpeg?: { path: string; version: string } | null
}

/** 素材の詳細に出すもの。page はプラグインのフォルダの中の HTML で、隔離した iframe で開く。 */
export type ItemView = { kind: 'image' } | { kind: 'video' } | { kind: 'audio' } | { kind: 'page'; url: string }

/** プラグインを入れたり外したりする操作。ない操作のボタンは出さない。 */
export interface PluginActions {
  /** 取得先から入れて、ライブラリに記録する。folder と zip は選ぶ窓を出す。選ばなかったときは false。 */
  install?: (from: PluginSource | 'folder' | 'zip') => Promise<boolean>
  /** 記録してある取得先から入れ直す。 */
  update?: (id: string) => Promise<void>
  /** アプリに入っているものを、このライブラリでも使う。 */
  use?: (id: string) => Promise<void>
  /** ライブラリの記録から外す。 */
  remove?: (id: string) => Promise<void>
  setSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
}
