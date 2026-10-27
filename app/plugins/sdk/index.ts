/*
 * プラグインを作るための型と補助。plugin.json の形と、組み込み UI に渡す窓口を決める。
 * 正本は app/plugins/sdk/。plugin-template/patchouli/ は scripts/plugin-template.ts が写したもの。
 * 組み込み UI からは `@patchouli/plugin` として読む（ビルドでは cli.ts が、型の確認では tsconfig の paths がここを指す）。
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

/** 組み込み UI に渡す窓口。 */
export interface Api<T extends PluginTypes = PluginTypes> extends Caller<MethodsOf<T>> {
  item: Item
  /** 中身を offset から最大 length バイト読む（一度に 16 MB まで）。終わりに近ければ短くなる。 */
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>
  /**
   * 依存先（plugin.json の required / optional の plugins）のプラグイン id の WASM を呼ぶ窓口。M はそのプラグインの methods。
   * 呼べるのは、有効で版の下限を満たすものだけ。そうでなければ call が失敗する。
   */
  plugin<M extends object = AnyMethods>(id: string): Caller<M>
  /** 自分の設定のいまの値。 */
  settings(): Promise<SettingsOf<T>>
  setSetting<K extends keyof SettingsOf<T> & string>(key: K, value: SettingsOf<T>[K]): Promise<void>
  /** 自分で残した値。ライブラリごとに残る（WASM の get-data と同じもの）。ないときは undefined。 */
  getData(key: string): Promise<string | undefined>
  /** 値を残す。value がなければ消す。 */
  setData(key: string, value?: string): Promise<void>
}

/** サムネイルを作るときの窓口。edge は長いほうの辺の上限（px）。 */
export interface ThumbnailApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  edge: number
}

/** 波形を作るときの窓口。signal は、時間の上限を過ぎて止めてほしいときに中止になる。 */
export interface WaveformApi<T extends PluginTypes = PluginTypes> extends Api<T> {
  points: number
  signal: AbortSignal
}

/** できたサムネイル。png は長いほうの辺が edge 以下の PNG。width と height は素材そのものの大きさ。 */
export interface Thumbnail {
  png: Blob | ArrayBuffer | Uint8Array
  width?: number
  height?: number
}

/** 組み込み UI の ES モジュールが default で書き出すもの。受け持つもの（plugin.json の formats の ui）の分だけあればよい。 */
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
   * 音の波形。素材の頭から終わりまでを points 個の区間に等分し、区間ごとの音の大きさ（二乗平均の平方根、0 以上）を返す。
   * 作らないときは null。
   */
  waveform?(api: WaveformApi<T>): Promise<ArrayLike<number> | null>
}

/**
 * 組み込み UI を決める。`export default definePlugin<{ methods: …; settings: … }>({ mount, thumbnail })` のように書く。
 * 中身はそのまま返すだけで、型を付けるためのもの。
 */
export const definePlugin = <T extends PluginTypes = PluginTypes>(mod: PluginModule<T>): PluginModule<T> => mod
