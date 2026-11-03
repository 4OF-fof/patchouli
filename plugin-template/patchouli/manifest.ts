/* plugin.json の形。 */

/**
 * 形式ごとに受け持つもの。details はファイルの詳細に足す行、menu は右クリックメニューに足す項目、
 * content は内容で探したり分けたりするときに読む区間。
 * waveform は音の波形、hover はカーソルを合わせたときにサムネイルの上に重ねる表示、
 * embed はノートに埋め込んだときの表示で、この 3 つは elevated だけが受け持てる。
 * link はファイルが指す URL（ショートカットなど）で、elevated だけが受け持てる。link を受け持つ形式のサムネイル・詳細の表示・
 * 埋め込み・ファイルの詳細は、ほかに受け持つものがなければ、URL に当てはまる links のプラグインか本体が受け持つ。
 */
export type Part = 'thumbnail' | 'view' | 'waveform' | 'hover' | 'details' | 'embed' | 'menu' | 'content' | 'link'

/** links で受け持てるもの。 */
export type LinkPart = 'thumbnail' | 'view' | 'embed' | 'details'

/** カーソルを合わせたときに、本体がサムネイルの上で見せるもの。video は元のファイルを音を消して再生する。 */
export type Hover = 'video'

/**
 * ノートに埋め込んだときに、本体が見せるもの。view は詳細と同じ表示（画像・動画・音声）、card はサムネイルと名前のカード。
 * 詳細を elevated で描く形式は、view でも埋め込みには描かない。
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
  /** 何に使うか。プラグインの画面に出す。 */
  description?: string
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
  /** カーソルを合わせたときに、本体が見せるもの。elevated の hover があれば、そちらを使う。 */
  hover?: Hover
  /** ノートに埋め込んだときに、本体が見せるもの。書かなければ view。elevated の embed があれば、そちらを使う。 */
  embed?: Embed
  /** 権限を絞った WASM（plugin.wasm）で受け持つもの。ファイルは本体が渡したものだけを読め、ネットワークは使えない。 */
  sandbox?: Part[]
  /**
   * 本体の画面と同じ WebView で動く TypeScript（plugin.json の elevated）で受け持つもの。
   * sandbox と同じものを書いたときは、こちらを使う。中から api.sandbox() で sandbox の同じものを呼べる。
   */
  elevated?: Part[]
  /** 詳細用に WASM が PNG にしたものを、取っておけるようにする。取っておくかは、本体が足す設定の項目で選ぶ。 */
  keepDecoded?: boolean
}

/** URL ごとに受け持つもの。ネットワークを使うことが多いので、elevated だけが受け持てる。 */
export interface LinkDecl {
  elevated?: LinkPart[]
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
   * formats の elevated を受け持つ ES モジュール（plugin.json からの相対パス、.js）。中身は PluginModule。
   * ビルドでは、拡張子を .ts にしたものから作る。
   */
  elevated?: string
  formats?: Record<string, FormatDecl>
  /**
   * URL のホスト名 → 受け持つもの。ホスト名はサブドメインも含む（youtube.com は www.youtube.com にも当てはまる）。
   * 当てはまるものが複数あるときは、いちばん長いホスト名のものを使う。同じホスト名を複数のプラグインが書いたら、どれも使わない。
   */
  links?: Record<string, LinkDecl>
  /** api.fetch で取りに行けるホスト名。サブドメインも含む。 */
  fetch?: string[]
}
