/* plugin.json の型定義と検証。 */
import rules from './rules.json' with { type: 'json' }

/**
 * 形式ごとに対応する機能。
 * - thumbnail: サムネイル生成
 * - view: 詳細表示。WASM は PNG を返し、スクリプトは DOM に描画する
 * - details: ファイルの詳細欄に追加する行
 * - excerpt: AI 検索・自動分類のために抽出する区間データ
 * - hover: サムネイルにカーソルを合わせたときのホバー表示
 * - embed: ノートに埋め込んだときの表示
 *
 * hover・embed はスクリプトのみ対応可能。
 */
export type Part = 'thumbnail' | 'view' | 'details' | 'excerpt' | 'hover' | 'embed'

/**
 * アプリ本体が標準プレーヤーで表示するメディア種別。詳細表示とノートへの埋め込みを標準コンポーネントで表示し、
 * ホバー時は video を消音で再生し、audio を音声付きで再生する。parts に view・hover・embed がある場合はそちらが優先される。
 */
export type Media = 'image' | 'video' | 'audio'

/** サムネイルの表示方法。center は中央基準で切り抜き、top は上端基準で切り抜き、contain は切り抜かずに全体を表示する。 */
export type Fit = 'center' | 'top' | 'contain'

/** 外部コマンドのバージョン取得方法。args で実行し、出力から正規表現 pattern でバージョン文字列を抽出する（キャプチャグループがあれば第 1 グループ）。 */
export interface Probe {
  args?: string[]
  pattern: string
}

/** 依存する外部コマンド 1 件の設定。min を指定する場合は version も必須。 */
export interface CommandDep {
  min?: string
  version?: Probe
  /** 用途の説明。プラグイン一覧に表示される。 */
  description?: string
}

/** 依存する他プラグイン 1 件の設定。 */
export interface PluginDep {
  min?: string
}

/** 依存関係の設定。 */
export interface Deps {
  /**
   * 外部コマンド（コマンド名 → 最小バージョンなど）。PATH または設定で指定された場所から検索する。
   * 外部コマンドは WASM サンドボックスの外で、アプリ本体と同じ権限で実行される。
   */
  commands?: Record<string, CommandDep>
  /** 依存プラグイン（プラグイン ID → 最小バージョン）。 */
  plugins?: Record<string, PluginDep>
}

/** 同じ設定で扱う拡張子の定義。 */
export interface FormatDecl {
  /** 拡張子の配列。小文字に正規化される。 */
  ext: string[]
  label?: string
  /** 既定の縦横比（幅 / 高さ）。サムネイル生成前に使用される。 */
  ratio?: number
  /** サムネイルの表示方法（省略時は center）。 */
  fit?: Fit
  media?: Media
  /** 対応する機能。 */
  parts?: Part[]
  /**
   * parts のうちスクリプト（plugin.json トップレベルの script）で処理するもの。指定しないものは WASM（plugin.wasm）が処理する。
   * WASM はアプリから渡されたファイルのみ読み取り可能で、スクリプト内からは api.wasm() で WASM の同名機能を呼び出せる。
   */
  script?: Part[]
}

/**
 * URL のホスト名ごとの対応設定。対応する機能はすべてスクリプトで実装する。
 * アプリ本体が扱うショートカット（.url）もリンク先 URL に一致するものが処理する。thumbnail・view・details・embed に未対応の場合はアプリ本体が OGP から生成する。
 */
export interface LinkDecl {
  /**
   * ホスト名の配列（サブドメインも含む）。
   * 複数一致する場合は最も長いホスト名の設定が使われる。同じホスト名を複数のプラグインが指定した場合は競合となり使用されない。
   */
  host: string[]
  /** 対応する機能。指定可能な値は formats の parts と同じ。 */
  parts?: Part[]
}

/** アプリに追加するカスタム画面。ホームや「すべて」と並べてナビゲーションメニューやコマンドから開ける。描画はスクリプトの screens で行う。 */
export interface ScreenDecl {
  /** ナビゲーションメニューやタブに表示する名前。 */
  label: string
  /** アプリ本体のアイコン名（home・grid・note など）。省略時や未定義の名前はプラグインのアイコンになる。 */
  icon?: string
  /** ナビゲーションメニュー・コマンド・起動時の画面の選択肢に表示するか（省略時は true）。false の画面は右クリックメニューなどから開く。 */
  place?: boolean
}

/**
 * 右クリックメニューに項目を追加する対象。WASM の menu・run-menu で処理する。
 * formats には拡張子の配列、all（ノートを含む全項目）、files（ノートを除く全ファイル）のいずれかを指定する（ノートの拡張子は md）。
 * 選択中の項目がすべて対象に含まれる場合のみ項目が表示される。
 */
export interface MenuDecl {
  formats: string[] | 'all' | 'files'
}

/** フックの対象。formats の指定方法は menu と同じ。 */
export interface HookDecl {
  formats: string[] | 'all' | 'files'
}

/**
 * フックの設定。対象形式の項目に対して WASM の hook をバックグラウンドで呼び出す。
 * added は取り込み時（右クリックメニューで作成したノートや追加した素材を含む）、
 * changed は内容変更時（ノートは編集後に画面を離れたとき、ファイルは外部での変更を検出したとき）、
 * edited は名前・タグ・所属の変更時。フック内で行われた変更に対してはフックは再実行されない。
 */
export interface HooksDecl {
  added?: HookDecl
  changed?: HookDecl
  edited?: HookDecl
}

/** ノートの / メニューに追加する項目。 */
export interface SlashDecl {
  /** メニューに表示する名前。 */
  label: string
  /** アプリ本体のアイコン名（codeBlock・diagram・math など）。省略時や未定義の名前はプラグインのアイコンになる。 */
  icon?: string
  /** / メニューの絞り込みで名前のほかに一致させる検索語（空白区切り）。 */
  keys?: string
  /** 挿入するテキスト。カーソル行が空ならその行に、文字があれば次の段落として挿入し、$0 の位置にカーソルを置く。 */
  insert: string
}

/**
 * ノート機能の拡張設定。
 * code には ``` の直後に記述する言語名を指定する（小文字に正規化される）。
 * 同じ言語名を外部プラグインとコア機能が指定した場合は外部プラグインが優先され、外部プラグインどうしが重複した場合はどちらも使用されない。
 */
export interface NotesDecl {
  code?: string[]
  /** code のうちスクリプトで描画するもの。指定しないものは WASM の code の render が SVG または PNG を返す。 */
  script?: string[]
  slash?: SlashDecl[]
}

/** 概要カードを配置できる画面。tag はタグの概要、project はプロジェクトの概要。 */
export type CoverOn = 'tag' | 'project'

/** タグやプロジェクトの概要欄に追加するカード。描画はスクリプトの covers で行う。 */
export interface CoverDecl {
  /** カードの見出しと「セクションを追加」メニューに表示する名前。 */
  label: string
  /** 「セクションを追加」メニューで名前の下に表示する補足説明。 */
  note?: string
  /** 配置できる画面（省略時は両方）。 */
  on?: CoverOn[]
  /** 1 つの概要欄に複数配置できるか（省略時は false）。 */
  multiple?: boolean
}

/**
 * WASM に許可するホストインターフェース（WIT）。指定していないインターフェースを import する WASM は読み込まれない。
 * library は項目情報の読み取り、embed は EmbeddingGemma による文章のベクトル化と類似検索、
 * clipboard はクリップボードへのコピー、notes はノートの作成と本文の更新、edit は名前とタグの変更、
 * assets は素材の追加とファイル内容の置き換え、export はライブラリ外へのファイルの書き出し。clipboard と export は run-menu 内でのみ使用可能。
 */
export type Permission = 'library' | 'clipboard' | 'notes' | 'edit' | 'assets' | 'export' | 'embed'

/** plugin.json の型。 */
export interface Manifest {
  id: string
  name: string
  version: string
  description?: string
  /** 必須の依存関係。 */
  required?: Deps
  /** 任意の依存関係。 */
  optional?: Deps
  /**
   * formats の script、links、screens、notes の script、covers を処理する ES モジュール（plugin.json からの相対パス、.js）。
   * ビルド時は拡張子を .ts に置き換えたソースファイルからバンドルされる。
   */
  script?: string
  formats?: FormatDecl[]
  links?: LinkDecl[]
  /** 画面 ID → 画面の設定。ID には英数字・ハイフン・アンダースコアのみ使用可能。 */
  screens?: Record<string, ScreenDecl>
  menu?: MenuDecl
  hooks?: HooksDecl
  notes?: NotesDecl
  /** カード ID → 概要カードの設定。ID には英数字・ハイフン・アンダースコアのみ使用可能。 */
  covers?: Record<string, CoverDecl>
  permissions?: Permission[]
  /** スクリプトの api.fetch と WASM の host::fetch で通信を許可するホスト名（サブドメインも含む。「com」のようなトップレベルドメイン単体は指定不可）。 */
  fetch?: string[]
}

/** permissions に指定可能な値の一覧。 */
export const PERMISSIONS: readonly string[] = rules.permissions

const COVER_ON: readonly string[] = ['tag', 'project'] satisfies CoverOn[]

/** plugin.json からの相対パスであり、親ディレクトリへ出ないか判定する。 */
const inside = (rel: string) =>
  rel !== '' && !/^([\\/]|[A-Za-z]:)/.test(rel) && rel.split(/[\\/]/).every((c) => c !== '' && c !== '.' && c !== '..')

/**
 * アプリ本体の読み込み時と同じ規則（rules.json）で plugin.json を検証する。
 */
export function checkManifest(m: Manifest): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (!new RegExp(rules.id).test(m.id)) errors.push(`プラグイン ID「${m.id}」の形式が正しくありません`)
  for (const x of m.permissions ?? [])
    if (!PERMISSIONS.includes(x))
      errors.push(`permissions の「${x}」は無効です（${PERMISSIONS.join('・')} のいずれかを指定してください）`)
  for (const id of Object.keys(m.screens ?? {}))
    if (!new RegExp(rules.screenId).test(id))
      errors.push(`画面の ID「${id}」には、英数字・ハイフン・アンダースコアのみ使用できます`)
  for (const h of m.fetch ?? [])
    if (!new RegExp(rules.fetchHost).test(h.replace(/\.+$/, '').toLowerCase()))
      errors.push(`fetch の「${h}」は無効です（「example.com」のようにドメイン名を指定してください）`)
  if (m.script !== undefined && !inside(m.script))
    errors.push(`script のファイル（${m.script}）は plugin.json のフォルダ内に配置してください`)
  for (const d of m.formats ?? []) {
    for (const ext of d.ext)
      if (ext !== ext.toLowerCase()) warnings.push(`formats の「${ext}」は小文字として扱われます`)
    for (const p of d.script ?? [])
      if (!d.parts?.includes(p)) errors.push(`「.${d.ext.join('・.')}」の script の ${p} は parts にも指定してください`)
  }
  const code = m.notes?.code ?? []
  for (const lang of code) {
    if (!new RegExp(rules.codeLang).test(lang)) errors.push(`notes の code の「${lang}」に空白や \` は使用できません`)
    if (lang !== lang.toLowerCase()) warnings.push(`notes の code の「${lang}」は小文字として扱われます`)
  }
  for (const lang of m.notes?.script ?? [])
    if (!code.some((c) => c.toLowerCase() === lang.toLowerCase()))
      errors.push(`notes の script の「${lang}」は code にも指定してください`)
  for (const s of m.notes?.slash ?? [])
    if (!s.label || typeof s.insert !== 'string') errors.push('notes の slash には label と insert を指定してください')
  for (const [id, c] of Object.entries(m.covers ?? {})) {
    if (!new RegExp(rules.screenId).test(id))
      errors.push(`カードの ID「${id}」には、英数字・ハイフン・アンダースコアのみ使用できます`)
    if (!c.label?.trim()) errors.push(`カード「${id}」の label が空です`)
    if (c.on && !c.on.length) errors.push(`カード「${id}」の on が空です（tag・project のいずれかを指定してください）`)
    if (c.on?.some((o) => !COVER_ON.includes(o)))
      errors.push(`カード「${id}」の on には tag・project のいずれかを指定してください`)
  }
  return { errors, warnings }
}
