/* プラグインの形。plugin.json と、Rust 側（src-tauri/src/plugin/）から届くもの。Rust 側と合わせる。 */

import type { Deps, Fit, Hover, Part, SettingValue } from '../../plugins/sdk'

export type {
  CommandDep,
  Deps,
  Fit,
  FormatDecl,
  Hover,
  Manifest,
  Part,
  PluginDep,
  Probe,
  SettingValue,
} from '../../plugins/sdk'

export type By = 'wasm' | 'ui'

export interface Cap {
  part: Part
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

export type PluginState = 'active' | 'missing' | 'blocked' | 'disabled'

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
  settings: Setting[]
  problems: Problem[]
}

export interface PluginReport {
  plugins: PluginStatus[]
  commands?: CommandStatus[]
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
}

export type ItemView =
  | { kind: 'image'; url?: string }
  | { kind: 'video' }
  | { kind: 'audio' }
  | { kind: 'ui'; plugin: string; url: string }

export interface PluginActions {
  install?: () => Promise<boolean>
  update?: (id: string) => Promise<void>
  remove?: (id: string) => Promise<void>
  setSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
  setEnabled?: (id: string, dev: boolean, enabled: boolean) => Promise<void>
}
