/* plugin.json の形。 */
import rules from './rules.json' with { type: 'json' }

/**
 * 形式ごとに受け持つもの。
 * - thumbnail: サムネイル
 * - view: 詳細の表示。WASM は本体が読めない画像を PNG にし、スクリプトは描く
 * - details: ファイルの詳細に足す行
 * - excerpt: 内容で探したり分けたりするときに読む区間
 * - hover: カーソルを合わせたときにサムネイルの上に重ねる表示
 * - embed: ノートに埋め込んだときの表示
 *
 * hover・embed は、スクリプトだけが受け持てる。
 */
export type Part = 'thumbnail' | 'view' | 'details' | 'excerpt' | 'hover' | 'embed'

/**
 * 本体がそのまま出す種類。詳細の表示に出し、カーソルを合わせたときは video を音を消して再生し、audio を鳴らす。
 * ノートに埋め込んだときも、そのまま出す。parts の view・hover・embed があれば、そちらを使う。
 */
export type Media = 'image' | 'video' | 'audio'

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
  /**
   * 手元のコマンド（名前 → 版の下限など）。PATH から探す。
   * コマンドは sandbox の外で、本体と同じ権限で動く。シェルやインタプリタを書けば、何でも実行できる。
   */
  commands?: Record<string, CommandDep>
  /** ほかのプラグイン（id → 版の下限）。 */
  plugins?: Record<string, PluginDep>
}

/** 同じ扱いの拡張子のまとまり。 */
export interface FormatDecl {
  /** 拡張子。小文字にそろえて読む。 */
  ext: string[]
  label?: string
  /** 縦横比（幅 / 高さ）の既定。サムネイルができるまで使う。 */
  ratio?: number
  /** サムネイルの枠への収め方。書かなければ center。 */
  fit?: Fit
  media?: Media
  /** 受け持つもの。 */
  parts?: Part[]
  /**
   * parts のうち、スクリプト（plugin.json の上の階層の script）で受け持つもの。ほかは WASM（plugin.wasm）が受け持つ。
   * WASM は、ファイルは本体が渡したものだけを読め、ネットワークは使えない。
   * ただし commands で動かすコマンドは本体と同じ権限で動くので、どのファイルも読み書きでき、ネットワークも使える。
   * スクリプトの中から api.sandbox() で、WASM の同じものを呼べる。
   */
  script?: Part[]
}

/**
 * 同じ扱いの URL のまとまり。受け持つものはすべてスクリプトが描く。
 * 本体が読むショートカット（.url）も、指す URL に当てはまるものが描く。thumbnail・view・details・embed は、なければ本体がページの OGP から作る。
 */
export interface LinkDecl {
  /**
   * ホスト名。サブドメインも含む（youtube.com は www.youtube.com にも当てはまる）。
   * 当てはまるものが複数あるときは、いちばん長いホスト名のものを使う。同じホスト名を複数のプラグインが書いたら、どれも使わない。
   */
  host: string[]
  /** 受け持つもの。書けるものは formats の parts と同じ。 */
  parts?: Part[]
}

/** 本体に足す画面。ホームやすべてと並べて、場所のメニューやコマンドから開ける。描くのは elevated の screens。 */
export interface ScreenDecl {
  /** 場所のメニューやタブに出す名前。 */
  label: string
  /** 本体のアイコンの名前（home・grid・note など）。書かないときや、本体にないものは、プラグインのアイコンにする。 */
  icon?: string
  /** 場所のメニュー・コマンド・起動時に開く画面に並べるか。書かなければ true。false のものは右クリックメニューなどから開く。 */
  place?: boolean
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
   * formats の script、links、screens、by が elevated の menu を受け持つ ES モジュール（plugin.json からの相対パス、.js）。
   * 中身は PluginModule で、本体の画面と同じ WebView で、本体と同じ権限で動く。ビルドでは、拡張子を .ts にしたものから作る。
   */
  script?: string
  formats?: FormatDecl[]
  links?: LinkDecl[]
  /** 画面の id → 画面。id は英数字・ハイフン・下線で書く。 */
  screens?: Record<string, ScreenDecl>
  menu?: MenuDecl
  hooks?: HooksDecl
  permissions?: Permission[]
  /** api.fetch で取りに行けるホスト名。サブドメインも含む。「com」のようなトップレベルドメインだけのものは書けない。 */
  fetch?: string[]
}

/** permissions に書けるもの。 */
export const PERMISSIONS: readonly string[] = rules.permissions

/** plugin.json からの相対パスで、外に出ないもの。 */
const inside = (rel: string) =>
  rel !== '' && !/^([\\/]|[A-Za-z]:)/.test(rel) && rel.split(/[\\/]/).every((c) => c !== '' && c !== '.' && c !== '..')

/**
 * アプリが読み込むときと同じ決まり（rules.json）で plugin.json を確かめる。
 * errors はアプリが問題として報告するもの、warnings は読めるが直したほうがよいもの。
 */
export function checkManifest(m: Manifest): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (!new RegExp(rules.id).test(m.id)) errors.push(`プラグイン ID「${m.id}」の形式が正しくありません`)
  for (const x of m.permissions ?? [])
    if (!PERMISSIONS.includes(x))
      errors.push(`permissions の「${x}」は使えません（${PERMISSIONS.join('・')} のどれか）`)
  for (const id of Object.keys(m.screens ?? {}))
    if (!new RegExp(rules.screenId).test(id))
      errors.push(`画面の ID「${id}」には、英数字・ハイフン・下線しか使えません`)
  for (const h of m.fetch ?? [])
    if (!new RegExp(rules.fetchHost).test(h.replace(/\.+$/, '').toLowerCase()))
      errors.push(`fetch の「${h}」は使えません（「example.com」のように、ドメイン名まで書きます）`)
  if (m.script !== undefined && !inside(m.script))
    errors.push(`script のファイル（${m.script}）は、plugin.json のあるフォルダの中に置きます`)
  for (const d of m.formats ?? []) {
    for (const ext of d.ext)
      if (ext !== ext.toLowerCase()) warnings.push(`formats の「${ext}」は、小文字にそろえて読みます`)
    for (const p of d.script ?? [])
      if (!d.parts?.includes(p)) errors.push(`「.${d.ext.join('・.')}」の script の ${p} は、parts にも書きます`)
  }
  return { errors, warnings }
}
