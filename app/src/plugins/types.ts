/* プラグインの形。plugin.json と、Rust 側（src-tauri/src/plugin/）から届くもの。Rust 側と合わせる。 */

/** 形式ごとに受け持つもの。 */
export type Part = 'thumbnail' | 'view'

/** 受け持ち方。wasm は宣言型（WASM が記述を返し、本体が描く）、ui は組み込み UI（隔離せずに本体の画面で動く）。 */
export type By = 'wasm' | 'ui'

/** 受け持つもの 1 つ。 */
export interface Cap {
  part: Part
  by: By
}

/** 求めるもの。 */
export interface Deps {
  /** 手元のコマンドの名前（PATH から探す）。 */
  commands?: string[]
  /** ほかのプラグインの id。 */
  plugins?: string[]
}

export interface FormatDecl {
  /** 引き継ぐ形式。自分で受け持たないものと、書いていない呼び名などはそちらのものを使う。 */
  extends?: string
  label?: string
  /** 縦横比（幅 / 高さ）の既定。サムネイルができるまで使う。 */
  ratio?: number
  /** WASM で受け持つもの。 */
  parts?: Part[]
  /** 組み込み UI で受け持つもの。 */
  ui?: Part[]
}

/** plugin.json。 */
export interface Manifest {
  id: string
  name: string
  version: string
  description?: string
  /** ないと動かないもの。 */
  required?: Deps
  /** あれば使うもの。 */
  optional?: Deps
  /** 組み込み UI の ES モジュール（plugin.json からの相対パス）。中身は ui.ts の UiModule。 */
  ui?: string
  formats: Record<string, FormatDecl>
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
  /** 受け持つプラグインの id。 */
  plugin: string
  /** サムネイルを作れる。 */
  thumbnail: boolean
  /** サムネイルを組み込み UI が作るときの、その UI。 */
  uiThumbnail?: UiRef
}

export interface Problem {
  level: 'error' | 'warning'
  text: string
}

/** プラグインの取得先。local は手元の zip。 */
export type PluginSource = { local: string }

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

/** active 使っている / missing ライブラリに記録してあるがアプリに入っていない */
export type PluginState = 'active' | 'missing'

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
  required: Deps
  optional: Deps
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
}
