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
  /** 自分の設定のいまの値。 */
  settings(): Promise<Record<string, SettingValue>>
  setSetting(key: string, value: SettingValue): Promise<void>
}

/** できたサムネイル。png は長いほうの辺が edge 以下の PNG。width と height は素材そのものの大きさ。 */
export interface UiThumbnail {
  png: Blob | ArrayBuffer | Uint8Array
  width?: number
  height?: number
}

/** 組み込み UI の ES モジュールが書き出すもの。受け持つもの（plugin.json の ui）の分だけあればよい。 */
export interface UiModule {
  /** 詳細の表示。el の中に描く。返した関数は、閉じるときに呼ぶ。 */
  mount?: (el: HTMLElement, api: UiApi) => void | (() => void)
  /** サムネイル。作らないときは null。 */
  thumbnail?: (api: UiApi & { edge: number }) => Promise<UiThumbnail | null>
}

/** サムネイルの長いほうの辺の長さ（px）。src-tauri/src/thumb.rs と合わせる。 */
export const EDGE = 512

const loaded = new Map<string, Promise<UiModule>>()

const isFn = (v: unknown) => v === undefined || typeof v === 'function'
const isModule = (m: unknown): m is UiModule =>
  typeof m === 'object' && m !== null && isFn(Reflect.get(m, 'mount')) && isFn(Reflect.get(m, 'thumbnail'))

/** url の ES モジュールを読む。一度読んだものは使い回す。 */
export const loadUi = (url: string): Promise<UiModule> => {
  let m = loaded.get(url)
  if (!m) {
    m = import(/* @vite-ignore */ url).then((mod: unknown) => {
      if (!isModule(mod)) throw new Error('mount と thumbnail が関数として export されていません')
      return mod
    })
    loaded.set(url, m)
    m.catch(() => loaded.delete(url))
  }
  return m
}

/** UI にサムネイルを作らせ、PNG の中身にする。 */
export async function uiThumbnail(
  url: string,
  api: UiApi,
): Promise<{ png: Uint8Array; width?: number; height?: number } | null> {
  const mod = await loadUi(url)
  if (!mod.thumbnail) throw new Error('サムネイル生成の関数（thumbnail）が見つかりません')
  const t = await mod.thumbnail({ ...api, edge: EDGE })
  if (!t) return null
  const png =
    t.png instanceof Uint8Array ? t.png : new Uint8Array(t.png instanceof Blob ? await t.png.arrayBuffer() : t.png)
  return { png, width: t.width, height: t.height }
}
