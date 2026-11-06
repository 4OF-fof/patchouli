/*
 * プラグインを作るための型と補助。plugin.json の形と、スクリプトに渡す窓口を決める。
 * 正本は app/plugins/sdk/。plugin-template/patchouli/ は scripts/plugin-template.ts が写したもの。
 * スクリプトからは `@patchouli/plugin` として読む（ビルドでは cli.ts が、型の確認では tsconfig の paths がここを指す）。
 *
 * スクリプトは本体の画面と同じ文書で描くので、本体の CSS 変数（--ink・--card・--accent・--space-* など）を使える。
 * mount・embed・screens で描く場所の中では、素の要素が本体の部品と同じに見える。
 * - button・input・select・textarea などに、本体と同じ見た目が付く（プラグインの CSS で上書きできる）
 * - select は、押すと本体と同じ一覧を出す。選んだあとは素の select と同じく value が変わり、input と change が届く
 * - data-tip を付けた要素には、その文言で本体のツールチップが出る
 */

export type SettingValue = boolean | number | string

export type * from './manifest.ts'

/** UI に渡す素材。 */
export interface Item {
  id: string
  name: string
  /** 拡張子（小文字）。 */
  ext: string
  /** 中身の URL。fetch や img・video の src にそのまま使える。ない環境もある。 */
  url?: string
}

/**
 * プラグインごとの型。definePlugin に渡すと、窓口の call と設定に型が付く。
 * - methods: WASM の call で呼べるもの。名前 → 関数の形（引数は 0 か 1 つ）。引数と戻り値は JSON にして受け渡す
 * - settings: 設定の key → 値の型。WASM の settings で返す項目と合わせる
 */
export interface PluginTypes {
  methods?: object
  settings?: object
}

/** 型を決めていない call。 */
export type AnyMethods = Record<string, (args?: unknown) => unknown>

type MethodsOf<T> = T extends { methods: infer M extends object } ? M : AnyMethods
type SettingsOf<T> = T extends { settings: infer S extends object } ? S : Record<string, SettingValue>
type ArgsOf<F> = F extends (...args: infer A) => unknown ? A : never
type ResultOf<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never

/** WASM の call を呼ぶ窓口。 */
export interface Caller<M extends object = AnyMethods> {
  /** WASM の call を呼ぶ。引数は JSON にして渡し、返ってきた JSON を読んで返す（空なら undefined）。 */
  call<K extends keyof M & string>(method: K, ...args: ArgsOf<M[K]>): Promise<ResultOf<M[K]>>
}

/** 自分の設定と、自分で残した値の窓口。 */
export interface OwnApi<T extends PluginTypes = PluginTypes> {
  /** 自分の設定のいまの値。 */
  settings(): Promise<SettingsOf<T>>
  setSetting<K extends keyof SettingsOf<T> & string>(key: K, value: SettingsOf<T>[K]): Promise<void>
  /** 自分で残した値。ライブラリごとに残る（WASM の get-data と同じもの）。ないときは undefined。 */
  getData(key: string): Promise<string | undefined>
  /** 値を残す。value がなければ消す。 */
  setData(key: string, value?: string): Promise<void>
}

/** スクリプトに渡す、素材 1 つの窓口。 */
export interface Api<T extends PluginTypes = PluginTypes> extends Caller<MethodsOf<T>>, OwnApi<T> {
  item: Item
  /** 中身を offset から最大 length バイト読む（一度に 16 MB まで）。終わりに近ければ短くなる。 */
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>
  /**
   * 依存先（plugin.json の required / optional の plugins）のプラグイン id の WASM を呼ぶ窓口。M はそのプラグインの methods。
   * 呼べるのは、有効で版の下限を満たすものだけ。そうでなければ call が失敗する。
   */
  plugin<M extends object = AnyMethods>(id: string): Caller<M>
}

/** サムネイルを作るときの窓口。edge は長いほうの辺の上限（px）。 */
export interface ThumbnailApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  edge: number
  /** WASM の thumbnail を呼ぶ。plugin.wasm が thumbnail を export していなければ失敗する。 */
  wasm(): Promise<Thumbnail | null>
}

/** ファイルの詳細に足す 1 行。 */
export interface Detail {
  label: string
  value: string
}

/** ファイルの詳細を作るときの窓口。 */
export interface DetailsApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  /** WASM の details を呼ぶ。plugin.wasm が details を export していなければ失敗する。 */
  wasm(): Promise<Detail[]>
}

/** 内容で探したり分けたりするときに読む区間の上限。WIT の excerpt-budget と同じ。 */
export interface ExcerptBudget {
  /** 画像の区間の数。 */
  maxImageParts: number
  /** 音声の区間の数。 */
  maxAudioParts: number
  /** 文章の区間の数。 */
  maxTextParts: number
  /** 1 つの区間に入れる画像の数。 */
  maxImages: number
  /** 画像の長いほうの辺（px）。 */
  edge: number
  /** 1 つの区間の音声の長さ（秒）。 */
  maxAudioSecs: number
}

type Bytes = Blob | ArrayBuffer | Uint8Array

/** 本体が読む区間。images（PNG か JPEG）・audio（WAV）・text のどれか 1 つ。start と end は秒で、素材全体なら書かない。 */
export interface ExcerptPart {
  start?: number
  end?: number
  images?: Bytes[]
  audio?: Bytes
  text?: string
}

/** WASM が作った区間。中身は本体が持っていて、ここには位置と種類だけが来る。 */
export interface WasmPart {
  start?: number
  end?: number
  kind: 'images' | 'audio' | 'text'
}

/** 区間を作るときの窓口。signal は、時間の上限を過ぎたときや作り直しをやめたときに中止になる。 */
export interface ExcerptApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  budget: ExcerptBudget
  signal: AbortSignal
  /**
   * WASM の excerpt を呼ぶ。返した区間は、excerpt が返す区間に本体が足す（excerpt で返し直さない）。
   * plugin.wasm が excerpt を export していなければ失敗する。
   */
  wasm(): Promise<WasmPart[]>
}

/** できたサムネイル。png は長いほうの辺が edge 以下の PNG。width と height は素材そのものの大きさ。 */
export interface Thumbnail {
  png: Blob | ArrayBuffer | Uint8Array
  width?: number
  height?: number
}

/** api.fetch で取ってきたもの。url はリダイレクトをたどった先。 */
export interface Fetched {
  status: number
  url: string
  /** Content-Type。 */
  type?: string
  body: Uint8Array<ArrayBuffer>
}

/**
 * URL 1 つの窓口。fetch は本体が代わりに取りに行くので、CORS に縛られない。
 * 取りに行けるのは、plugin.json の fetch に書いたホスト名だけ（一度に 16 MB まで）。
 * スクリプトは本体と同じ権限で動くので、この制限は api.fetch を使うときの約束にすぎない。
 * 権限を絞れるのは WASM だけで、plugin.json の permissions も WASM にだけ効く。
 */
export interface LinkApi<T extends PluginTypes = PluginTypes> extends OwnApi<T> {
  url: string
  fetch(url: string): Promise<Fetched>
}

/** URL のサムネイルを作るときの窓口。 */
export interface LinkThumbnailApi<T extends PluginTypes = PluginTypes> extends LinkApi<T> {
  edge: number
}

/** URL の内容で探したり分けたりするときに読む区間を作る窓口。 */
export interface LinkExcerptApi<T extends PluginTypes = PluginTypes> extends LinkApi<T> {
  budget: ExcerptBudget
  signal: AbortSignal
}

/** plugin.json の links で受け持つもの。 */
export interface LinkModule<T extends PluginTypes = PluginTypes> {
  /** サムネイル。作らないときは null。 */
  thumbnail?(api: LinkThumbnailApi<T>): Promise<Thumbnail | null>
  /** 詳細の表示。返した関数は、閉じるときに呼ぶ。 */
  mount?(el: HTMLElement, api: LinkApi<T>): void | (() => void)
  /** ファイルの詳細に足す行。 */
  details?(api: LinkApi<T>): Promise<Detail[]>
  /** ショートカットの内容で探したり分けたりするときに読む区間。budget を超えない。 */
  excerpt?(api: LinkExcerptApi<T>): Promise<ExcerptPart[]>
  /** ショートカットにカーソルを合わせたときに、サムネイルの上に重ねる表示。返した関数は、外れたときに呼ぶ。 */
  hover?(el: HTMLElement, api: LinkApi<T>): void | (() => void)
  /** ノートに埋め込んだときの表示。ショートカットを埋め込んだときと、ノートに URL を埋め込んだときの両方に使う。 */
  embed?(el: HTMLElement, api: LinkApi<T>): void | (() => void)
}

/** 画面に渡す、ライブラリの項目。 */
export interface LibraryItem {
  id: string
  /** ノートか。ノートでなければ素材。 */
  note: boolean
  name: string
  /** 拡張子（小文字）。 */
  ext: string
  /** 入っているプロジェクト。 */
  project: string | null
  tags: string[]
  /** ノートの本文（Markdown）。ほかの項目へのリンクは [名前](patchouli:<id>)、埋め込みは ![名前](patchouli:<id>)。 */
  body?: string
  /** 素材のメモ。 */
  memo: string
  /** 更新した時刻（ミリ秒）。 */
  mtime?: number
  pinned: boolean
  /** 縦横比（幅 / 高さ）。 */
  ratio: number
  /** サムネイルの URL。まだできていないときはない。 */
  thumb?: string
  /** 中身の URL。ノートにはない。 */
  url?: string
}

/** 項目などを開くときの指定。 */
export interface OpenOptions {
  /** 新しいタブに開く。 */
  newTab?: boolean
}

/** 作るノート。name が同じノートがあれば、後ろに番号を付ける。project を書かなければ、どのプロジェクトにも入れない。 */
export interface NewNote {
  name?: string
  body?: string
  project?: string
}

/**
 * 画面の窓口。書き換えは、先に items に写してから保存する。保存できなかったときは、本体が通知を出して読み込み直す。
 */
export interface ScreenApi<T extends PluginTypes = PluginTypes> extends OwnApi<T> {
  /** 右クリックメニューから開いたときに選んでいたもの。場所のメニューなどから開いたときは空。 */
  targets(): LibraryItem[]
  /** いまのライブラリの項目すべて。 */
  items(): LibraryItem[]
  item(id: string): LibraryItem | undefined
  /** 項目が増えたり、変わったり、なくなったりしたら呼ぶ。返した関数で知らせをやめる。 */
  onChange(fn: () => void): () => void
  open(id: string, opts?: OpenOptions): void
  openTag(tag: string, opts?: OpenOptions): void
  openProject(name: string, opts?: OpenOptions): void
  createNote(note?: NewNote): Promise<LibraryItem>
  /** ノートの本文を書き換える。 */
  setBody(id: string, body: string): void
  setTags(id: string, tags: string[]): void
  rename(id: string, name: string): void
}

/** plugin.json の screens の 1 つ。 */
export interface ScreenModule<T extends PluginTypes = PluginTypes> {
  /** el の中に描く。el は画面いっぱいの大きさで、はみ出す分は送れる。返した関数は、閉じるときに呼ぶ。 */
  mount(el: HTMLElement, api: ScreenApi<T>): void | (() => void)
}

/** スクリプトの ES モジュールが default で書き出すもの。受け持つもの（plugin.json の formats の script など）の分だけあればよい。 */
export interface PluginModule<T extends PluginTypes = PluginTypes> {
  /** 詳細の表示。el の中に描く。返した関数は、閉じるときに呼ぶ。 */
  mount?(el: HTMLElement, api: Api<T>): void | (() => void)
  /** サムネイル。作らないときは null。 */
  thumbnail?(api: ThumbnailApi<T>): Promise<Thumbnail | null>
  /** サムネイルを作るのを待つ長さ（ms）。書かなければ 10 秒、長くても 30 秒まで。 */
  thumbnailTimeout?: number
  /**
   * カーソルを合わせたときに、サムネイルの上に重ねる表示。el の中に描く。返した関数は、カーソルが離れたときに呼ぶ。
   * 合わせているカードの 1 枚にだけ描くので、動画の再生や音を出すこともできる。
   */
  hover?(el: HTMLElement, api: Api<T>): void | (() => void)
  /**
   * ノートに埋め込んだときの表示。el の中に描く。el の幅は本文の幅で、高さは描いたものに合わせて決まる。
   * 返した関数は、埋め込みが消えるときに呼ぶ。
   */
  embed?(el: HTMLElement, api: Api<T>): void | (() => void)
  /** ファイルの詳細に足す行。 */
  details?(api: DetailsApi<T>): Promise<Detail[]>
  /** 内容で探したり分けたりするときに読む区間。区間の分け方はプラグインが決め、budget を超えない。 */
  excerpt?(api: ExcerptApi<T>): Promise<ExcerptPart[]>
  /** plugin.json の links で受け持つもの。 */
  links?: LinkModule<T>
  /** plugin.json の screens の id → 画面。 */
  screens?: Record<string, ScreenModule<T>>
}

/**
 * スクリプトを決める。`export default definePlugin<{ methods: …; settings: … }>({ mount, thumbnail })` のように書く。
 * 中身はそのまま返すだけで、型を付けるためのもの。
 */
export const definePlugin = <T extends PluginTypes = PluginTypes>(mod: PluginModule<T>): PluginModule<T> => mod
