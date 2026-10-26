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

/** コマンドの版の取り方。args で動かし、出力から pattern で版を拾う（グループがあれば最初のグループ）。 */
export interface Probe {
  args?: string[]
  pattern: string
}

/** 求めるコマンド 1 つ。min を書くときは、version に版の取り方も書く。 */
export interface CommandDep {
  min?: string
  version?: Probe
}

/** 求めるプラグイン 1 つ。 */
export interface PluginDep {
  min?: string
}

/** 求めるもの。 */
export interface Deps {
  /** 手元のコマンド（名前 → 版の下限など）。PATH から探す。 */
  commands?: Record<string, CommandDep>
  /** ほかのプラグイン（id → 版の下限）。 */
  plugins?: Record<string, PluginDep>
}

/** サムネイルを決まった形の枠に入れるときの収め方。center 真ん中を残して切り抜く / top 上の端を残して切り抜く / contain 切り抜かずに収める。 */
export type Fit = 'center' | 'top' | 'contain'

export interface FormatDecl {
  /** 引き継ぐ形式。自分で受け持たないものと、書いていない呼び名などはそちらのものを使う。 */
  extends?: string
  label?: string
  /** 縦横比（幅 / 高さ）の既定。サムネイルができるまで使う。 */
  ratio?: number
  /** サムネイルの枠への収め方。書かなければ center。 */
  fit?: Fit
  /** WASM で受け持つもの。 */
  parts?: Part[]
  /** 組み込み UI で受け持つもの。 */
  ui?: Part[]
  /** 詳細用に WASM が PNG にしたものを、取っておけるようにする。取っておくかは、本体が足す設定の項目で選ぶ。 */
  keepDecoded?: boolean
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
  fit: Fit
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

/** active 使っている / missing ライブラリに記録してあるがアプリに入っていない / blocked 必須の依存が足りないので読み込んでいない */
export type PluginState = 'active' | 'missing' | 'blocked'

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
}
