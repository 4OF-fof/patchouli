/*
 * 組み込み UI。plugin.json の script の ES モジュールを、隔離せずに本体の画面で動かす。中身は default で書き出した PluginModule。
 * 本体の画面と同じ文書で動くので、色や字体の CSS 変数（src/styles/tokens.css）はそのまま使え、
 * 描く場所の中では、ボタンや入力欄などの素の要素に本体と同じ見た目が付き、select は本体の一覧で開く（PluginView）。
 */
import type {
  Api,
  ExcerptApi,
  ExcerptBudget,
  ExcerptPart,
  Detail,
  DetailsApi,
  Item,
  LinkApi,
  LinkThumbnailApi,
  PluginModule,
  Thumbnail,
  ThumbnailApi,
} from '../../plugins/sdk'

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

const loaded = new Map<string, Promise<UiModule>>()

const MODULE_FNS = ['mount', 'thumbnail', 'hover', 'embed', 'details', 'excerpt']
const LINK_FNS = ['thumbnail', 'mount', 'details', 'excerpt', 'hover', 'embed']

const isFn = (v: unknown) => v === undefined || typeof v === 'function'
const isLinks = (v: unknown) =>
  v === undefined || (typeof v === 'object' && v !== null && LINK_FNS.every((k) => isFn(Reflect.get(v, k))))
const isMounts = (v: unknown) =>
  v === undefined ||
  (typeof v === 'object' &&
    v !== null &&
    Object.values(v).every((s: unknown) => typeof s === 'object' && s !== null && isFn(Reflect.get(s, 'mount'))))
const isCode = (v: unknown) =>
  v === undefined ||
  (typeof v === 'object' &&
    v !== null &&
    Object.values(v).every(
      (c: unknown) =>
        typeof c === 'object' &&
        c !== null &&
        typeof Reflect.get(c, 'render') === 'function' &&
        isFn(Reflect.get(c, 'update')),
    ))
const isModule = (m: unknown): m is UiModule =>
  typeof m === 'object' &&
  m !== null &&
  MODULE_FNS.every((k) => isFn(Reflect.get(m, k))) &&
  isLinks(Reflect.get(m, 'links')) &&
  isMounts(Reflect.get(m, 'screens')) &&
  isCode(Reflect.get(m, 'code')) &&
  isMounts(Reflect.get(m, 'covers'))

export const loadUi = (url: string): Promise<UiModule> => {
  let m = loaded.get(url)
  if (!m) {
    m = import(/* @vite-ignore */ url).then((ns: unknown) => {
      const mod: unknown = typeof ns === 'object' && ns !== null ? Reflect.get(ns, 'default') : undefined
      if (!isModule(mod))
        throw new Error(
          `default で書き出したものの ${MODULE_FNS.join('・')}、links の ${LINK_FNS.join('・')}、screens の mount、code の render・update、covers の mount のいずれかが関数ではありません`,
        )
      return mod
    })
    loaded.set(url, m)
    m.catch(() => loaded.delete(url))
  }
  return m
}

type MadeThumbnail = { png: Uint8Array; width?: number; height?: number }

/** making が作り終えるのを、mod の上限の時間まで待つ。 */
async function made(mod: UiModule, making: Promise<Thumbnail | null>): Promise<MadeThumbnail | null> {
  const limit = limitOf(mod)
  let timer = 0
  const late = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new ThumbnailTimeout(limit)), limit)
  })
  const t = await Promise.race([making, late]).finally(() => clearTimeout(timer))
  if (!t) return null
  const png =
    t.png instanceof Uint8Array ? t.png : new Uint8Array(t.png instanceof Blob ? await t.png.arrayBuffer() : t.png)
  return { png, width: t.width, height: t.height }
}

export async function uiThumbnail(url: string, api: Omit<ThumbnailApi, 'edge'>): Promise<MadeThumbnail | null> {
  const mod = await loadUi(url)
  if (!mod.thumbnail) throw new Error('サムネイル生成の関数（thumbnail）が見つかりません')
  return made(mod, mod.thumbnail({ ...api, edge: EDGE }))
}

const isText = (v: unknown, k: string) => typeof Reflect.get(Object(v), k) === 'string'

/** label と value が文字列のものだけを残す。 */
const details = (v: unknown): Detail[] =>
  Array.isArray(v) ? v.filter((x): x is Detail => isText(x, 'label') && isText(x, 'value')) : []

export async function uiDetails(url: string, api: DetailsApi): Promise<Detail[]> {
  const mod = await loadUi(url)
  if (!mod.details) throw new Error('ファイルの詳細を作る関数（details）が見つかりません')
  return details(await mod.details(api))
}

export async function uiLinkThumbnail(url: string, api: Omit<LinkThumbnailApi, 'edge'>): Promise<MadeThumbnail | null> {
  const mod = await loadUi(url)
  const links = mod.links
  if (!links?.thumbnail) throw new Error('URL のサムネイルを作る関数（links.thumbnail）が見つかりません')
  return made(mod, links.thumbnail({ ...api, edge: EDGE }))
}

export async function uiLinkDetails(url: string, api: LinkApi): Promise<Detail[]> {
  const mod = await loadUi(url)
  const links = mod.links
  if (!links?.details) throw new Error('URL の詳細を作る関数（links.details）が見つかりません')
  return details(await links.details(api))
}

/** 区間を作るのを待つ長さ。長い動画では数百回シークする。 */
const CONTENT_LIMIT = 600_000

/** stop が中止になるか、時間の上限を過ぎると、signal で止めてもらう。 */
async function excerptOf(run: (signal: AbortSignal) => Promise<ExcerptPart[]>, stop: AbortSignal) {
  const late = AbortSignal.timeout(CONTENT_LIMIT)
  const parts = await run(AbortSignal.any([stop, late]))
  if (late.aborted) throw new Error(`区間の作成が ${CONTENT_LIMIT / 1000} 秒以内に終わりませんでした`)
  return Array.isArray(parts) ? parts : []
}

export async function uiExcerpt(
  url: string,
  api: Omit<ExcerptApi, 'budget' | 'signal'>,
  budget: ExcerptBudget,
  stop: AbortSignal,
): Promise<ExcerptPart[]> {
  const mod = await loadUi(url)
  if (!mod.excerpt) throw new Error('区間を作る関数（excerpt）が見つかりません')
  return excerptOf((signal) => mod.excerpt?.({ ...api, budget, signal }) ?? Promise.resolve([]), stop)
}

export async function uiLinkExcerpt(
  url: string,
  api: LinkApi,
  budget: ExcerptBudget,
  stop: AbortSignal,
): Promise<ExcerptPart[]> {
  const links = (await loadUi(url)).links
  if (!links?.excerpt) throw new Error('URL の区間を作る関数（links.excerpt）が見つかりません')
  return excerptOf((signal) => links.excerpt?.({ ...api, budget, signal }) ?? Promise.resolve([]), stop)
}
