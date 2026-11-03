/* plugin.json の形。 */

/**
 * 形式ごとに受け持つもの。details はファイルの詳細に足す行、content は内容で探したり分けたりするときに読む区間。
 * waveform は音の波形、hover はカーソルを合わせたときにサムネイルの上に重ねる表示、
 * embed はノートに埋め込んだときの表示で、この 3 つは elevated だけが受け持てる。
 * link はファイルが指す URL（ショートカットなど）で、elevated だけが受け持てる。link を受け持つ形式のサムネイル・詳細の表示・
 * 埋め込み・ファイルの詳細は、ほかに受け持つものがなければ、URL に当てはまる links のプラグインか本体が受け持つ。
 */
export type Part = 'thumbnail' | 'view' | 'waveform' | 'hover' | 'details' | 'embed' | 'content' | 'link'

/** links で受け持てるもの。 */
export type LinkPart = 'thumbnail' | 'view' | 'embed' | 'details'

/** カーソルを合わせたときに、本体がサムネイルの上で見せるもの。video は元のファイルを音を消して再生する。 */
export type Hover = 'video' | 'audio'

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
  /**
   * true にすると、権限を絞った WASM（plugin.wasm）が export する役割（thumbnail・view・details・content）を受け持つ。
   * ファイルは本体が渡したものだけを読め、ネットワークは使えない。
   */
  sandbox?: boolean
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

/** 本体に足す画面。ホームやすべてと並べて、場所のメニューやコマンドから開ける。描くのは elevated の screens。 */
export interface ScreenDecl {
  /** 場所のメニューやタブに出す名前。 */
  label: string
  /** 本体のアイコンの名前（home・grid・note など）。書かないときや、本体にないものは、プラグインのアイコンにする。 */
  icon?: string
  /** 場所のメニュー・コマンド・起動時に開く画面に並べるか。書かなければ true。false のものは右クリックメニューなどから開く。 */
  place?: boolean
  /** 別のウィンドウで開いたときの大きさ（px）の既定。書かなければ 480 × 640。 */
  window?: { width?: number; height?: number }
}

/**
 * 右クリックメニューに項目を足す対象と担当。formats は拡張子の並び、all（ノートも含めたすべて）、files（ノートを除いたすべて）のどれか。
 * ノートの拡張子は md。選んだものがすべて対象のときだけ、項目を足す。同じものを対象にするプラグインが複数あれば、プラグインごとに並べる。
 */
export interface MenuDecl {
  formats: string[] | 'all' | 'files'
  /** sandbox は WASM の menu・run-menu、elevated は PluginModule の menu・runMenu で項目を作る。 */
  by: 'sandbox' | 'elevated'
}

/**
 * 取り込みのフック。added に書いた形式のものを取り込んだとき、WASM の hook の added を裏で呼ぶ。
 * formats の書き方は menu と同じで、by は sandbox だけ。
 */
export interface HooksDecl {
  added?: { formats: string[] | 'all' | 'files'; by: 'sandbox' }
}

/**
 * WASM に渡すホストの interface（WIT）。書いていないものを使う WASM は読み込まない。
 * library はライブラリの情報（名前・タグ・メモなど）を読み、embed は EmbeddingGemma で文章をベクトルにする。
 * clipboard はコピー、notes はノートの作成と本文の書き換え、edit は名前とタグの変更、assets は素材の登録と中身の置き換え、
 * export はライブラリの外への書き出し。clipboard と export は run-menu の中だけで使える。
 */
export type Permission = 'library' | 'clipboard' | 'notes' | 'edit' | 'assets' | 'export' | 'embed'

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
   * formats と links の elevated、screens、by が elevated の menu を受け持つ ES モジュール（plugin.json からの相対パス、.js）。中身は PluginModule。
   * ビルドでは、拡張子を .ts にしたものから作る。
   */
  elevated?: string
  formats?: Record<string, FormatDecl>
  /**
   * URL のホスト名 → 受け持つもの。ホスト名はサブドメインも含む（youtube.com は www.youtube.com にも当てはまる）。
   * 当てはまるものが複数あるときは、いちばん長いホスト名のものを使う。同じホスト名を複数のプラグインが書いたら、どれも使わない。
   */
  links?: Record<string, LinkDecl>
  /** 画面の id → 画面。id は英数字・ハイフン・下線で書く。 */
  screens?: Record<string, ScreenDecl>
  menu?: MenuDecl
  hooks?: HooksDecl
  permissions?: Permission[]
  /** api.fetch で取りに行けるホスト名。サブドメインも含む。 */
  fetch?: string[]
}
