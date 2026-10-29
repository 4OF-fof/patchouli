/* plugin.json の形。 */

/**
 * 形式ごとに受け持つもの。waveform は音の波形、hover はカーソルを合わせたときにサムネイルの上に重ねる表示、
 * embed はノートに埋め込んだときの表示で、どれも組み込み UI だけが受け持てる。
 * details はファイルの詳細に足す行、menu は右クリックメニューに足す項目で、どちらも WASM だけが受け持てる。
 */
export type Part = 'thumbnail' | 'view' | 'waveform' | 'hover' | 'details' | 'embed' | 'menu'

/** カーソルを合わせたときに、本体がサムネイルの上で見せるもの。video は元のファイルを音を消して再生する。 */
export type Hover = 'video'

/**
 * ノートに埋め込んだときに、本体が見せるもの。view は詳細と同じ表示（画像・動画・音声）、card はサムネイルと名前のカード。
 * 詳細を組み込み UI で描く形式は、view でも埋め込みには描かない。
 */
export type Embed = 'view' | 'card'

/** サムネイルを決まった形の枠に入れるときの収め方。center 真ん中を残して切り抜く / top 上の端を残して切り抜く / contain 切り抜かずに収める。 */
export type Fit = 'center' | 'top' | 'contain'

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

export interface FormatDecl {
  /** 引き継ぐ形式。自分で受け持たないものと、書いていない呼び名などはそちらのものを使う。 */
  extends?: string
  label?: string
  /** 縦横比（幅 / 高さ）の既定。サムネイルができるまで使う。 */
  ratio?: number
  /** サムネイルの枠への収め方。書かなければ center。 */
  fit?: Fit
  /** カーソルを合わせたときに、本体が見せるもの。組み込み UI の hover があれば、そちらを使う。 */
  hover?: Hover
  /** ノートに埋め込んだときに、本体が見せるもの。書かなければ view。組み込み UI の embed があれば、そちらを使う。 */
  embed?: Embed
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
  /**
   * 組み込み UI の ES モジュール（plugin.json からの相対パス、.js）。中身は PluginModule。
   * ビルドでは、拡張子を .ts にしたものから作る。
   */
  ui?: string
  formats: Record<string, FormatDecl>
}
