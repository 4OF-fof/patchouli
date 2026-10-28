/*
 * 組み込み UI。plugin.json の ui の ES モジュールを、隔離せずに本体の画面で動かす。中身は default で書き出した PluginModule。
 * 本体の画面と同じ文書で動くので、色や字体の CSS 変数（src/styles/tokens.css）はそのまま使え、
 * 詳細の表示の中では、ボタンや入力欄などの素の要素に本体と同じ見た目が付く（PluginView）。
 */
import type { Api, Item, PluginModule } from '../../plugins/sdk'

export type UiApi = Api
export type UiItem = Item
export type UiModule = PluginModule

const THUMB_LIMIT = 10_000
const THUMB_LIMIT_MAX = 30_000

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

export const WAVE_POINTS = 4000

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
  ['mount', 'thumbnail', 'waveform', 'hover', 'embed'].every((k) => isFn(Reflect.get(m, k)))

export const loadUi = (url: string): Promise<UiModule> => {
  let m = loaded.get(url)
  if (!m) {
    m = import(/* @vite-ignore */ url).then((ns: unknown) => {
      const mod: unknown = typeof ns === 'object' && ns !== null ? Reflect.get(ns, 'default') : undefined
      if (!isModule(mod))
        throw new Error(
          'default で書き出したものの mount・thumbnail・waveform・hover・embed のいずれかが関数ではありません',
        )
      return mod
    })
    loaded.set(url, m)
    m.catch(() => loaded.delete(url))
  }
  return m
}

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
  if (v.length !== WAVE_POINTS) throw new Error(`波形の区間の数（${v.length}）が ${WAVE_POINTS} と異なります`)
  // 小さい音のものも細かさを落とさないよう、いちばん大きい区間を 255 に合わせる
  const vals = Array.from(v, (x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const top = Math.max(...vals)
  const scale = top > 0 ? 255 / top : 0
  return Uint8Array.from(vals, (x) => Math.round(x * scale))
}
