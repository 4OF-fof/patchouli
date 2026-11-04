/* プラグインの形。plugin.json と、Rust 側（src-tauri/src/plugin/）から届くもの。Rust 側と合わせる。 */

import type { Deps, Embed, Fit, Hover, LinkPart, Part, Permission, SettingValue } from '../../plugins/sdk'

export type {
  CommandDep,
  Deps,
  Embed,
  Fit,
  FormatDecl,
  Hover,
  LinkDecl,
  LinkPart,
  Manifest,
  MenuDecl,
  MenuOutput,
  Part,
  Permission,
  PluginDep,
  Probe,
  ScreenDecl,
  SettingValue,
} from '../../plugins/sdk'

export type By = 'sandbox' | 'elevated'

/** 受け持つもの。formats の Part に、plugin.json の menu の右クリックメニューを足したもの。 */
export type CapPart = Part | 'menu'

export interface Cap {
  part: CapPart
  by: By
}

export interface UiRef {
  plugin: string
  module: string
}

export interface FormatInfo {
  ext: string
  label: string
  ratio: number
  fit: Fit
  plugin: string
  thumbnail: boolean
  uiThumbnail?: UiRef
  uiWaveform?: UiRef
  hover?: Hover
  uiHover?: UiRef
  embed?: Embed
  uiEmbed?: UiRef
  /** ファイルが指す URL を読むもの。あれば、ほかに受け持つもののない部分は URL ごとに受け持つものが描く。 */
  uiLink?: UiRef
}

/** URL のホスト名ごとに受け持つプラグイン。 */
export interface LinkInfo extends UiRef {
  host: string
  parts: LinkPart[]
}

/** プラグインが足す画面。 */
export interface ScreenInfo extends UiRef {
  id: string
  label: string
  icon?: string
  place: boolean
  window: { width: number; height: number }
}

export interface Problem {
  level: 'error' | 'warning'
  text: string
}

export type PluginSource = { local: string }

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

export type PluginState = 'active' | 'missing' | 'broken' | 'blocked' | 'disabled'

export interface PluginStatus {
  id: string
  name: string
  version?: string
  recorded?: string
  source?: PluginSource
  description: string
  builtin: boolean
  dev: boolean
  enabled: boolean
  state: PluginState
  required: Deps
  optional: Deps
  via: Via[]
  caps: Cap[]
  formats: string[]
  /** 受け持つ URL のホスト名。 */
  links?: string[]
  /** 足す画面の名前。 */
  screens?: string[]
  permissions?: Permission[]
  /** elevated を持つか。持つものは本体と同じ権限で動く。 */
  elevated?: boolean
  /** plugin.json の fetch に書いたホスト名。 */
  fetch?: string[]
  settings: Setting[]
  problems: Problem[]
}

export interface PluginReport {
  plugins: PluginStatus[]
  commands?: CommandStatus[]
  /** 複数のプラグインが受け持っているため、どれも使っていない形式。plugins はプラグインの id。 */
  conflicts?: Conflict[]
  /** 複数のプラグインが受け持っているため、どれも使っていないホスト名。 */
  linkConflicts?: LinkConflict[]
}

export interface Conflict {
  ext: string
  plugins: string[]
}

export interface LinkConflict {
  host: string
  plugins: string[]
}

export interface CommandStatus {
  name: string
  path?: string
  version?: string
}

export interface Via {
  name: string
  plugin: string
  required: boolean
}

/** ファイルの詳細。rows はプラグインが足す行。 */
export interface ItemDetails {
  size: number
  rows: { label: string; value: string }[]
  /** 素材が指す URL。あれば、サイズの代わりに押して開ける URL の行を出す。 */
  url?: string
}

/** プラグインが右クリックメニューに足す項目。 */
export interface MenuEntry {
  id: string
  label: string
}

/** プラグイン 1 つが右クリックメニューに足す項目。 */
export interface MenuGroup {
  plugin: string
  items: MenuEntry[]
}

export type ItemView =
  | { kind: 'image'; url?: string }
  | { kind: 'video' }
  | { kind: 'audio' }
  | { kind: 'ui'; plugin: string; url: string }
  /** ファイルが指す URL。ui があれば links のプラグインが描き、なければページをそのまま出す。 */
  | { kind: 'link'; url: string; ui?: { plugin: string; url: string } }

export interface PluginActions {
  install?: () => Promise<boolean>
  update?: (id: string) => Promise<void>
  remove?: (id: string) => Promise<void>
  setSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
  setEnabled?: (id: string, dev: boolean, enabled: boolean) => Promise<void>
}
