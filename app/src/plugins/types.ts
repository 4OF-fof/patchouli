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

/** 受け持ち方。wasm は宣言型（WASM が記述を返し、本体が描く）、ui は組み込み UI（隔離せずに本体の画面で動く）。 */
export type By = 'wasm' | 'ui'

/** 受け持つもの 1 つ。 */
export interface Cap {
  part: Part
  by: By
}

/** 組み込み UI の場所。module はプラグインのフォルダの中のパス。 */
export interface UiRef {
  plugin: string
  module: string
}

/** 引き継ぎをたどったあとの形式。 */
export interface FormatInfo {
  ext: string
  label: string
  ratio: number
  fit: Fit
  /** 受け持つプラグインの id。 */
  plugin: string
  /** サムネイルを作れる。 */
  thumbnail: boolean
  /** サムネイルを組み込み UI が作るときの、その UI。 */
  uiThumbnail?: UiRef
  /** 波形を作る組み込み UI。 */
  uiWaveform?: UiRef
  /** カーソルを合わせたときに、本体が見せるもの。 */
  hover?: Hover
  /** カーソルを合わせたときの表示を描く組み込み UI。 */
  uiHover?: UiRef
}

export interface Problem {
  level: 'error' | 'warning'
  text: string
}

/** プラグインの取得先。local は手元の zip。 */
export type PluginSource = { local: string }

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

/**
 * active 使っている / missing ライブラリに記録してあるがアプリに入っていない / blocked 必須の依存が足りないので読み込んでいない /
 * disabled 無効にしてある、または同じ id の開発版を使っている
 */
export type PluginState = 'active' | 'missing' | 'blocked' | 'disabled'

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
  /** 開発者モードのフォルダの中の開発版。 */
  dev: boolean
  /** 有効にしてある。組み込みのものはいつも有効。 */
  enabled: boolean
  state: PluginState
  required: Deps
  optional: Deps
  /** 依存先を通して動かせるコマンド。 */
  via: Via[]
  /** 受け持つもの。 */
  caps: Cap[]
  /** 受け持っている形式。 */
  formats: string[]
  settings: Setting[]
  problems: Problem[]
}

export interface PluginReport {
  plugins: PluginStatus[]
  /** 使っているプラグインが求めるコマンド。名前順。ないときはコマンドを探さない環境。 */
  commands?: CommandStatus[]
}

/** 求められたコマンド。 */
export interface CommandStatus {
  name: string
  /** 見つけた場所。見つからなければない。 */
  path?: string
  /** 見つけたものの版。版の取り方を書いたプラグインがなければない。 */
  version?: string
}

/** 依存先のプラグインを通して動かせるコマンド。required は、その依存先が必須か。 */
export interface Via {
  name: string
  /** 依存先のプラグインの名前。 */
  plugin: string
  required: boolean
}

/**
 * 素材の詳細に出すもの。image の url は WASM が PNG にしたもので、なければ素材そのものを出す。
 * ui は組み込み UI が描く（url はその ES モジュール）。
 */
export type ItemView =
  | { kind: 'image'; url?: string }
  | { kind: 'video' }
  | { kind: 'audio' }
  | { kind: 'ui'; plugin: string; url: string }

/** プラグインを入れたり外したりする操作。ない操作のボタンは出さない。 */
export interface PluginActions {
  /** 選ぶ窓を出して手元の zip から入れ、ライブラリに記録する。選ばなかったときは false。 */
  install?: () => Promise<boolean>
  /** 記録してある取得先から入れ直す。 */
  update?: (id: string) => Promise<void>
  /** アンインストールする（ライブラリの記録から外す）。 */
  remove?: (id: string) => Promise<void>
  setSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
  /** 有効・無効を切り替える。dev は開発版のほうか。 */
  setEnabled?: (id: string, dev: boolean, enabled: boolean) => Promise<void>
}
