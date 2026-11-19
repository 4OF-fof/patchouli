/*
 * プラグイン作成用の型定義とヘルパー。plugin.json の型とスクリプトに渡される API を定義する。
 * 元ファイルは app/plugins/sdk/ にあり、テンプレートの patchouli/ は scripts/plugin-template.ts でコピーされる。
 * スクリプトからは `@patchouli/plugin` として import する（ビルド時は cli.ts、型チェック時は tsconfig の paths で解決される）。
 *
 * スクリプトはアプリ本体と同じドキュメント上で描画されるため、本体の CSS 変数（--ink・--card・--accent・--space-* など）を使用できる。
 * mount・embed・screens・code・covers の描画領域内では標準の HTML 要素にアプリ本体のスタイルが適用される。
 * - button・input・select・textarea などにアプリ本体と同じスタイルが付く（プラグイン側の CSS で上書き可能）
 * - select をクリックするとアプリ本体のカスタムドロップダウンが開き、選択時は標準の select と同様に value の更新と input・change イベントの発火が行われる
 * - data-tip 属性を付けた要素にはアプリ本体のツールチップが表示される
 */

import type { CoverOn } from './manifest.ts'

export type SettingValue = boolean | number | string

/** JSON として扱える値。 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type * from './manifest.ts'

/** スクリプトに渡される素材情報。 */
export interface Item {
  id: string
  name: string
  /** 拡張子（小文字）。 */
  ext: string
  /** 実ファイルの URL。fetch や img・video の src にそのまま使用できる（環境によっては未定義）。 */
  url?: string
}

/**
 * プラグインごとの型定義。definePlugin に型引数として渡すと call と settings に型が付く。
 * - methods: WASM の call で呼び出せる関数（名前 → 関数型、引数は 0 個または 1 個）。引数と戻り値は JSON として受け渡される
 * - settings: 設定のキー → 値の型。WASM の settings で返す項目と合わせる
 */
export interface PluginTypes {
  methods?: object
  settings?: object
}

/** 型指定なしの call。 */
export type AnyMethods = Record<string, (args?: unknown) => unknown>

type MethodsOf<T> = T extends { methods: infer M extends object } ? M : AnyMethods
type SettingsOf<T> = T extends { settings: infer S extends object } ? S : Record<string, SettingValue>
type ArgsOf<F> = F extends (...args: infer A) => unknown ? A : never
type ResultOf<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never

/** WASM の call を呼び出すインターフェース。 */
export interface Caller<M extends object = AnyMethods> {
  /** WASM の call を呼び出す。引数は JSON に変換して渡し、戻り値の JSON をパースして返す（空文字列なら undefined）。 */
  call<K extends keyof M & string>(method: K, ...args: ArgsOf<M[K]>): Promise<ResultOf<M[K]>>
}

/** プラグイン設定と保存データの操作 API。 */
export interface OwnApi<T extends PluginTypes = PluginTypes> {
  /** 現在の設定値を取得する。 */
  settings(): Promise<SettingsOf<T>>
  setSetting<K extends keyof SettingsOf<T> & string>(key: K, value: SettingsOf<T>[K]): Promise<void>
  /** ライブラリごとに保存されたプラグイン固有データを取得する（WASM の get-data と共通）。未保存の場合は undefined。 */
  getData(key: string): Promise<string | undefined>
  /** データを保存する。value を省略すると削除される。 */
  setData(key: string, value?: string): Promise<void>
}

/** 素材 1 件に対してスクリプトに渡される API。 */
export interface Api<T extends PluginTypes = PluginTypes> extends Caller<MethodsOf<T>>, OwnApi<T> {
  item: Item
  /** ファイル内容を offset から最大 length バイト読み取る（1 回につき最大 16 MB）。末尾付近では短くなる。 */
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>
  /**
   * 依存プラグイン（plugin.json の required / optional の plugins）の WASM を呼び出す。M は対象プラグインの methods。
   * 対象プラグインが有効かつ最小バージョンを満たしている場合のみ呼び出し可能。
   */
  plugin<M extends object = AnyMethods>(id: string): Caller<M>
}

/** サムネイル生成時の API。edge は長辺の最大サイズ（px）。 */
export interface ThumbnailApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  edge: number
  /** WASM の thumbnail を呼び出す。plugin.wasm が thumbnail を export していない場合は失敗する。 */
  wasm(): Promise<Thumbnail | null>
}

/** ファイルの詳細欄に追加する 1 行。 */
export interface Detail {
  label: string
  value: string
}

/** ファイル詳細の取得時の API。 */
export interface DetailsApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  /** WASM の details を呼び出す。plugin.wasm が details を export していない場合は失敗する。 */
  wasm(): Promise<Detail[]>
}

/** AI 検索・自動分類で抽出する区間データの上限。WIT の excerpt-budget と同じ。 */
export interface ExcerptBudget {
  /** 画像区間の最大数。 */
  maxImageParts: number
  /** 音声区間の最大数。 */
  maxAudioParts: number
  /** テキスト区間の最大数。 */
  maxTextParts: number
  /** 1 区間あたりの最大画像数。 */
  maxImages: number
  /** 画像の長辺の最大サイズ（px）。 */
  edge: number
  /** 1 区間あたりの音声の最大秒数。 */
  maxAudioSecs: number
}

type Bytes = Blob | ArrayBuffer | Uint8Array

/** アプリ本体が読み取る区間データ。images（PNG または JPEG）・audio（WAV）・text のいずれか 1 つを指定する。start と end は秒数（ファイル全体なら省略）。 */
export interface ExcerptPart {
  start?: number
  end?: number
  images?: Bytes[]
  audio?: Bytes
  text?: string
}

/** WASM が生成した区間のメタ情報。実データはアプリ本体側で保持され、位置と種別のみが返る。 */
export interface WasmPart {
  start?: number
  end?: number
  kind: 'images' | 'audio' | 'text'
}

/** 区間抽出時の API。signal はタイムアウト時や中断時に abort される。 */
export interface ExcerptApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  budget: ExcerptBudget
  signal: AbortSignal
  /**
   * WASM の excerpt を呼び出す。生成された区間データはアプリ本体側で結合されるため、スクリプトの戻り値に含める必要はない。
   * plugin.wasm が excerpt を export していない場合は失敗する。
   */
  wasm(): Promise<WasmPart[]>
}

/** 生成されたサムネイル。png は長辺が edge 以下の PNG。width と height は元素材のピクセルサイズ。 */
export interface Thumbnail {
  png: Blob | ArrayBuffer | Uint8Array
  width?: number
  height?: number
}

/** api.fetch のレスポンス。url はリダイレクト解決後の URL。 */
export interface Fetched {
  status: number
  url: string
  /** Content-Type。 */
  type?: string
  body: Uint8Array<ArrayBuffer>
}

/**
 * URL 用の API。fetch はアプリ本体経由で HTTP GET を行うため CORS の制限を受けない。
 * 通信先は plugin.json の fetch に指定したホスト名に制限される（最大 16 MB）。
 */
export interface LinkApi<T extends PluginTypes = PluginTypes> extends OwnApi<T> {
  url: string
  fetch(url: string): Promise<Fetched>
}

/** URL のサムネイル生成時の API。 */
export interface LinkThumbnailApi<T extends PluginTypes = PluginTypes> extends LinkApi<T> {
  edge: number
}

/** URL の区間抽出時の API。 */
export interface LinkExcerptApi<T extends PluginTypes = PluginTypes> extends LinkApi<T> {
  budget: ExcerptBudget
  signal: AbortSignal
}

/** plugin.json の links に対応する実装。 */
export interface LinkModule<T extends PluginTypes = PluginTypes> {
  /** サムネイルを生成する。生成しない場合は null を返す。 */
  thumbnail?(api: LinkThumbnailApi<T>): Promise<Thumbnail | null>
  /** 詳細表示を描画する。戻り値の関数は画面を閉じるときに呼ばれる。 */
  mount?(el: HTMLElement, api: LinkApi<T>): void | (() => void)
  /** ファイルの詳細欄に追加する行を返す。 */
  details?(api: LinkApi<T>): Promise<Detail[]>
  /** ショートカットの AI 検索・自動分類用の区間データを返す。budget の上限内で返す。 */
  excerpt?(api: LinkExcerptApi<T>): Promise<ExcerptPart[]>
  /** ショートカットのサムネイルにカーソルを合わせたときのホバー表示を描画する。戻り値の関数はカーソルが離れたときに呼ばれる。 */
  hover?(el: HTMLElement, api: LinkApi<T>): void | (() => void)
  /** ノートへの埋め込み表示を描画する。ショートカットの埋め込みと URL の直接埋め込みの両方で使われる。 */
  embed?(el: HTMLElement, api: LinkApi<T>): void | (() => void)
}

/** WASM の code の render が返す描画結果。svg は SVG 文字列、png は PNG バイト列。 */
export type CodeImage = { svg: string } | { png: Uint8Array<ArrayBuffer> }

/**
 * ノートのコードブロック 1 件に対する API。fetch は LinkApi と同様に plugin.json の fetch に指定したホストへのみ通信可能。
 */
export interface CodeApi<T extends PluginTypes = PluginTypes> extends OwnApi<T> {
  /** ``` の直後に指定された言語名（小文字）。 */
  lang: string
  /** コードブロックの中身（囲みの ``` の行を除く）。 */
  readonly source: string
  /** コードブロックの中身を書き換える。呼び出すと update（未定義なら render）が再度呼ばれる。 */
  setSource(source: string): void
  /** WASM の code の render を現在の source で呼び出す。plugin.wasm が code を export していない場合は失敗する。 */
  wasm(): Promise<CodeImage>
  fetch(url: string): Promise<Fetched>
}

/** plugin.json の notes の script に指定した言語のコードブロック描画モジュール。 */
export interface CodeModule<T extends PluginTypes = PluginTypes> {
  /**
   * el 内に描画する。el の幅は本文の幅になり、高さは描画内容に合わせて決まる。戻り値の関数は破棄時に呼ばれる。
   * el 内のクリックやキー入力はノートエディタ側には伝播しない。
   */
  render(el: HTMLElement, api: CodeApi<T>): void | (() => void)
  /**
   * 内容が変更されたとき（エディタでの編集時や setSource の呼び出し後）に表示を更新する。api.source で最新の内容を取得できる。
   * 省略した場合は render が返したクリーンアップ関数を実行してから再度 render が呼ばれる。
   */
  update?(el: HTMLElement, api: CodeApi<T>): void
}

/** 項目のメタデータ。 */
export interface ItemMeta {
  /** 素材のメモ。 */
  memo: string
  /** 取得元のページなどの URL。 */
  url?: string
}

/** 画面 API に渡されるライブラリの項目情報。 */
export interface LibraryItem {
  id: string
  /** ノートなら true、素材なら false。 */
  note: boolean
  name: string
  /** 拡張子（小文字）。 */
  ext: string
  /** 所属するプロジェクト名。 */
  project: string | null
  tags: string[]
  /** ノートの本文（Markdown）。他項目へのリンクは [名前](patchouli:<id>)、埋め込みは ![名前](patchouli:<id>)。 */
  body?: string
  /** 項目のメタデータ。 */
  meta: ItemMeta
  /** 更新日時（ミリ秒）。 */
  mtime?: number
  pinned: boolean
  /** 縦横比（幅 / 高さ）。 */
  ratio: number
  /** サムネイルの URL（未生成の場合は undefined）。 */
  thumb?: string
  /** 実ファイルの URL（ノートには存在しない）。 */
  url?: string
}

/** 項目や画面を開く際のオプション。 */
export interface OpenOptions {
  /** 新しいタブで開く。 */
  newTab?: boolean
}

/** 作成するノートの指定。同名のノートがある場合は末尾に連番が付く。project 省略時は所属なしになる。 */
export interface NewNote {
  name?: string
  body?: string
  project?: string
}

/**
 * カスタム画面用の API。更新操作は即座に items に反映された後、ディスクへ保存される（保存失敗時はエラー通知を出して再読み込みされる）。
 */
export interface ScreenApi<T extends PluginTypes = PluginTypes> extends OwnApi<T> {
  /** 右クリックメニューから開いた際に選択されていた項目。メニュー以外から開いた場合は空配列。 */
  targets(): LibraryItem[]
  /** 現在のライブラリ内の全項目。 */
  items(): LibraryItem[]
  item(id: string): LibraryItem | undefined
  /** 項目の追加・変更・削除時に呼ばれるリスナーを登録する。戻り値の関数で解除する。 */
  onChange(fn: () => void): () => void
  open(id: string, opts?: OpenOptions): void
  openTag(tag: string, opts?: OpenOptions): void
  openProject(name: string, opts?: OpenOptions): void
  createNote(note?: NewNote): Promise<LibraryItem>
  /** ノートの本文を更新する。 */
  setBody(id: string, body: string): void
  setTags(id: string, tags: string[]): void
  rename(id: string, name: string): void
}

/** plugin.json の screens の 1 画面分の実装。 */
export interface ScreenModule<T extends PluginTypes = PluginTypes> {
  /** el 内に画面を描画する。el は画面全体の領域を持ち、溢れた内容はスクロール可能になる。戻り値の関数は画面を閉じるときに呼ばれる。 */
  mount(el: HTMLElement, api: ScreenApi<T>): void | (() => void)
}

/** タグやプロジェクトの概要欄に配置されたカード 1 枚に対する API。 */
export interface CoverApi<T extends PluginTypes = PluginTypes> extends OwnApi<T> {
  /** 配置先の画面種別（tag はタグの概要、project はプロジェクトの概要）。 */
  on: CoverOn
  /** タグ名またはプロジェクト名。 */
  name: string
  /** カードの ID。同じ概要欄に同種のカードを複数配置した際の識別に使える。 */
  id: string
  /** カードに保存された JSON 値（未保存なら undefined）。 */
  readonly value: Json | undefined
  /** カードに JSON 値を保存する。value 省略時は削除される。カード自体が削除された際も消去される。 */
  setValue(value?: Json): void
  /** 「概要を編集」モード中かどうか。 */
  readonly editing: boolean
  /** 編集モードの開始・終了時に呼ばれるリスナーを登録する。戻り値の関数で解除する。 */
  onEditing(fn: (editing: boolean) => void): () => void
  /** 画面に表示されている対象項目の一覧。タグ画面でサブタグ絞り込み中は絞り込み後の項目、プロジェクト画面ではサブフォルダ内を含む全項目。 */
  items(): LibraryItem[]
  /** 対象項目またはカードの保存値が変更されたときに呼ばれるリスナーを登録する。戻り値の関数で解除する。 */
  onChange(fn: () => void): () => void
  open(id: string, opts?: OpenOptions): void
  openTag(tag: string, opts?: OpenOptions): void
}

/** plugin.json の covers の 1 カード分の実装。 */
export interface CoverModule<T extends PluginTypes = PluginTypes> {
  /** el 内にカードを描画する。el の幅は概要欄の幅になり、高さは描画内容に合わせて決まる。戻り値の関数は破棄時に呼ばれる。 */
  mount(el: HTMLElement, api: CoverApi<T>): void | (() => void)
}

/** スクリプトの ES モジュールが default エクスポートするオブジェクト。対応する機能（plugin.json の formats の script など）のみ実装すればよい。 */
export interface PluginModule<T extends PluginTypes = PluginTypes> {
  /** 詳細表示を el 内に描画する。戻り値の関数は画面を閉じるときに呼ばれる。 */
  mount?(el: HTMLElement, api: Api<T>): void | (() => void)
  /** サムネイルを生成する。生成しない場合は null を返す。 */
  thumbnail?(api: ThumbnailApi<T>): Promise<Thumbnail | null>
  /** サムネイル生成のタイムアウト時間（ms）。省略時は 10 秒、最大 30 秒。 */
  thumbnailTimeout?: number
  /**
   * サムネイルにカーソルを合わせたときのホバー表示を el 内に描画する。戻り値の関数はカーソルが離れたときに呼ばれる。
   * カーソルが乗っている 1 枚に対してのみ呼ばれるため、動画や音声の再生も可能。
   */
  hover?(el: HTMLElement, api: Api<T>): void | (() => void)
  /**
   * ノートへの埋め込み表示を el 内に描画する。el の幅は本文の幅になり、高さは描画内容に合わせて決まる。
   * 戻り値の関数は埋め込み要素が破棄されるときに呼ばれる。
   */
  embed?(el: HTMLElement, api: Api<T>): void | (() => void)
  /** ファイルの詳細欄に追加する行を返す。 */
  details?(api: DetailsApi<T>): Promise<Detail[]>
  /** AI 検索・自動分類用の区間データを返す。区間の分割方法はプラグインが決定し、budget の上限内で返す。 */
  excerpt?(api: ExcerptApi<T>): Promise<ExcerptPart[]>
  /** plugin.json の links に対応する実装。 */
  links?: LinkModule<T>
  /** plugin.json の screens の ID → 画面の実装。 */
  screens?: Record<string, ScreenModule<T>>
  /** plugin.json の notes の script に指定した言語名（小文字） → コードブロックの実装。 */
  code?: Record<string, CodeModule<T>>
  /** plugin.json の covers の ID → 概要カードの実装。 */
  covers?: Record<string, CoverModule<T>>
}

/**
 * スクリプトモジュールを定義するヘルパー。`export default definePlugin<{ methods: …; settings: … }>({ mount, thumbnail })` のように記述する。
 * 渡されたオブジェクトをそのまま返し、型推論を補助する。
 */
export const definePlugin = <T extends PluginTypes = PluginTypes>(mod: PluginModule<T>): PluginModule<T> => mod
