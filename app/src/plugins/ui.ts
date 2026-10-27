/*
 * 組み込み UI。plugin.json の ui の ES モジュールを、隔離せずに本体の画面で動かす。
 * 本体の画面と同じ文書で動くので、色や字体の CSS 変数（src/styles/tokens.css）はそのまま使え、
 * 詳細の表示の中では、ボタンや入力欄などの素の要素に本体と同じ見た目が付く（PluginView）。
 */
import type { SettingValue } from './types'

/** UI に渡す素材。 */
export interface UiItem {
  id: string
  name: string
  /** 拡張子（小文字）。 */
  ext: string
  /** 中身の URL。fetch や img・video の src にそのまま使える。ない環境もある。 */
  url?: string
}

/** 組み込み UI に渡す窓口。 */
export interface UiApi {
  item: UiItem
  /** 中身を offset から最大 length バイト読む（一度に 16 MB まで）。 */
  read(offset: number, length: number): Promise<ArrayBuffer>
  /** 自分の WASM の call を呼ぶ。method と args の中身はプラグインが決める。 */
  call(method: string, args: string): Promise<string>
  /**
   * 依存先（plugin.json の required / optional の plugins）のプラグイン id の WASM を呼ぶ窓口。
   * 呼べるのは、有効で版の下限を満たすものだけ。そうでなければ call が失敗する。
   */
  plugin(id: string): { call(method: string, args: string): Promise<string> }
  /** 自分の設定のいまの値。 */
  settings(): Promise<Record<string, SettingValue>>
  setSetting(key: string, value: SettingValue): Promise<void>
  /** 自分で残した値。ライブラリごとに残る。ないときは undefined。 */
  getData(key: string): Promise<string | undefined>
  /** 値を残す。value がなければ消す。 */
  setData(key: string, value?: string): Promise<void>
}

/** できたサムネイル。png は長いほうの辺が edge 以下の PNG。width と height は素材そのものの大きさ。 */
export interface UiThumbnail {
  png: Blob | ArrayBuffer | Uint8Array
  width?: number
  height?: number
}

/** 波形を作るときに渡す窓口。signal は、時間の上限を過ぎて止めてほしいときに中止になる。 */
export interface WaveformApi extends UiApi {
  points: number
  signal: AbortSignal
}

/** 組み込み UI の ES モジュールが書き出すもの。受け持つもの（plugin.json の ui）の分だけあればよい。 */
export interface UiModule {
  /** 詳細の表示。el の中に描く。返した関数は、閉じるときに呼ぶ。 */
  mount?: (el: HTMLElement, api: UiApi) => void | (() => void)
  /** サムネイル。作らないときは null。 */
  thumbnail?: (api: UiApi & { edge: number }) => Promise<UiThumbnail | null>
  /** サムネイルを作るのを待つ長さ（ms）。書かなければ 10 秒、長くても 30 秒まで。 */
  thumbnailTimeout?: number
  /**
   * カーソルを合わせたときに、サムネイルの上に重ねる表示。el の中に描く。返した関数は、カーソルが離れたときに呼ぶ。
   * 合わせているカードの 1 枚にだけ描くので、動画の再生や音を出すこともできる。
   */
  hover?: (el: HTMLElement, api: UiApi) => void | (() => void)
  /** 音の波形。素材を頭から points 個に等分した区間ごとの、音の大きさの最大（0〜1）を返す。作らないときは null。 */
  waveform?: (api: WaveformApi) => Promise<ArrayLike<number> | null>
}

const THUMB_LIMIT = 10_000
const THUMB_LIMIT_MAX = 30_000

/** サムネイルが待つ長さのうちに作り終わらなかった。 */
export class ThumbnailTimeout extends Error {
  readonly ms: number
  constructor(ms: number) {
    super(`サムネイルの生成が ${ms / 1000} 秒以内に終わりませんでした`)
    this.ms = ms
  }
}

const limitOf = (mod: UiModule) => {
  const t = mod.thumbnailTimeout
  return typeof t === 'number' && t > 0 ? Math.min(t, THUMB_LIMIT_MAX) : THUMB_LIMIT
}

/** サムネイルの長いほうの辺の長さ（px）。src-tauri/src/thumb.rs と合わせる。 */
export const EDGE = 512

/** 波形の点の数。詳細で、4K の画面の幅くらいまで滑らかに見える数。 */
export const WAVE_POINTS = 4000

/** 波形が時間の上限のうちに作り終わらなかった。 */
export class WaveformTimeout extends Error {
  readonly ms: number
  constructor(ms: number) {
    super(`波形の作成が ${ms / 1000} 秒以内に終わりませんでした`)
    this.ms = ms
  }
}

const loaded = new Map<string, Promise<UiModule>>()

const isFn = (v: unknown) => v === undefined || typeof v === 'function'
const isModule = (m: unknown): m is UiModule =>
  typeof m === 'object' &&
  m !== null &&
  ['mount', 'thumbnail', 'waveform', 'hover'].every((k) => isFn(Reflect.get(m, k)))

/** url の ES モジュールを読む。一度読んだものは使い回す。 */
export const loadUi = (url: string): Promise<UiModule> => {
  let m = loaded.get(url)
  if (!m) {
    m = import(/* @vite-ignore */ url).then((mod: unknown) => {
      if (!isModule(mod))
        throw new Error('export された mount・thumbnail・waveform・hover のいずれかが関数ではありません')
      return mod
    })
    loaded.set(url, m)
    m.catch(() => loaded.delete(url))
  }
  return m
}

/** UI にサムネイルを作らせ、PNG の中身にする。UI の決めた長さのうちに作り終わらなければ ThumbnailTimeout を投げる。 */
export async function uiThumbnail(
  url: string,
  api: UiApi,
): Promise<{ png: Uint8Array; width?: number; height?: number } | null> {
  const mod = await loadUi(url)
  if (!mod.thumbnail) throw new Error('サムネイル生成の関数（thumbnail）が見つかりません')
  const limit = limitOf(mod)
  let timer = 0
  const late = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new ThumbnailTimeout(limit)), limit)
  })
  const t = await Promise.race([mod.thumbnail({ ...api, edge: EDGE }), late]).finally(() => clearTimeout(timer))
  if (!t) return null
  const png =
    t.png instanceof Uint8Array ? t.png : new Uint8Array(t.png instanceof Blob ? await t.png.arrayBuffer() : t.png)
  return { png, width: t.width, height: t.height }
}

/** UI に波形を作らせ、各点を 0〜255 にする。limit（ms）を過ぎたら止めて WaveformTimeout を投げる。0 なら待ち続ける。 */
export async function uiWaveform(url: string, api: UiApi, limit: number): Promise<Uint8Array | null> {
  const mod = await loadUi(url)
  if (!mod.waveform) throw new Error('波形を作成する関数（waveform）が見つかりません')
  const stop = new AbortController()
  let timer = 0
  const late = new Promise<never>((_, reject) => {
    if (limit > 0)
      timer = window.setTimeout(() => {
        const e = new WaveformTimeout(limit)
        stop.abort(e)
        reject(e)
      }, limit)
  })
  const run = mod.waveform({ ...api, points: WAVE_POINTS, signal: stop.signal })
  // 止めたあとに届く失敗は、もう誰も待っていない
  run.catch(() => undefined)
  const v = await Promise.race([run, late]).finally(() => clearTimeout(timer))
  if (!v) return null
  if (v.length !== WAVE_POINTS) throw new Error(`波形の点の数（${v.length}）が ${WAVE_POINTS} と異なります`)
  return Uint8Array.from(v, (x) => Math.round(Math.min(1, Math.max(0, x || 0)) * 255))
}
