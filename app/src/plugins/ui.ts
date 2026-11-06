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
  MenuApi,
  MenuItem,
  MenuOutput,
  PluginModule,
  RunMenuApi,
  Thumbnail,
  ThumbnailApi,
  ToastLevel,
} from '../../plugins/sdk'

const TOAST_LEVELS: ToastLevel[] = ['info', 'success', 'warning', 'error']

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

const MODULE_FNS = ['mount', 'thumbnail', 'waveform', 'hover', 'embed', 'details', 'menu', 'runMenu', 'excerpt', 'link']
const LINK_FNS = ['thumbnail', 'mount', 'embed', 'details']

const isFn = (v: unknown) => v === undefined || typeof v === 'function'
const isLinks = (v: unknown) =>
  v === undefined || (typeof v === 'object' && v !== null && LINK_FNS.every((k) => isFn(Reflect.get(v, k))))
const isScreens = (v: unknown) =>
  v === undefined ||
  (typeof v === 'object' &&
    v !== null &&
    Object.values(v).every((s: unknown) => typeof s === 'object' && s !== null && isFn(Reflect.get(s, 'mount'))))
const isModule = (m: unknown): m is UiModule =>
  typeof m === 'object' &&
  m !== null &&
  MODULE_FNS.every((k) => isFn(Reflect.get(m, k))) &&
  isLinks(Reflect.get(m, 'links')) &&
  isScreens(Reflect.get(m, 'screens'))

export const loadUi = (url: string): Promise<UiModule> => {
  let m = loaded.get(url)
  if (!m) {
    m = import(/* @vite-ignore */ url).then((ns: unknown) => {
      const mod: unknown = typeof ns === 'object' && ns !== null ? Reflect.get(ns, 'default') : undefined
      if (!isModule(mod))
        throw new Error(
          `default で書き出したものの ${MODULE_FNS.join('・')}、links の ${LINK_FNS.join('・')}、screens の mount のいずれかが関数ではありません`,
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

const isText = (v: unknown, k: string) => typeof Reflect.get(Object(v), k) === 'string'

/** label と value が文字列のものだけを残す。 */
const pairs = <T extends Detail | MenuItem>(v: unknown, keys: [string, string]): T[] =>
  Array.isArray(v) ? v.filter((x): x is T => keys.every((k) => isText(x, k))) : []

export async function uiDetails(url: string, api: DetailsApi): Promise<Detail[]> {
  const mod = await loadUi(url)
  if (!mod.details) throw new Error('ファイルの詳細を作る関数（details）が見つかりません')
  return pairs(await mod.details(api), ['label', 'value'])
}

export async function uiMenu(url: string, api: MenuApi): Promise<MenuItem[]> {
  const mod = await loadUi(url)
  if (!mod.menu) throw new Error('右クリックメニューの項目を作る関数（menu）が見つかりません')
  return pairs(await mod.menu(api), ['id', 'label'])
}

/** 形の合わないものは出さない。 */
export const menuOutputOf = (v: unknown): MenuOutput | undefined => {
  const toast: unknown = Reflect.get(Object(v), 'toast')
  if (typeof toast === 'string') {
    const level = TOAST_LEVELS.find((l) => l === Reflect.get(Object(v), 'level'))
    return level ? { toast, level } : { toast }
  }
  const save: unknown = Reflect.get(Object(v), 'save')
  if (typeof save === 'object' && save !== null) {
    const name: unknown = Reflect.get(save, 'name')
    const data: unknown = Reflect.get(save, 'data')
    const ok = typeof data === 'string' || data instanceof Uint8Array || data instanceof ArrayBuffer
    return typeof name === 'string' && ok ? { save: { name, data } } : undefined
  }
  const s: unknown = Reflect.get(Object(v), 'screen')
  if (typeof s === 'object' && s !== null) {
    const id: unknown = Reflect.get(s, 'id')
    return typeof id === 'string' ? { screen: { id, window: Reflect.get(s, 'window') === true } } : undefined
  }
  const o: unknown = Reflect.get(Object(v), 'overlay')
  if (typeof o !== 'object' || o === null) return undefined
  const title: unknown = Reflect.get(o, 'title')
  return {
    overlay: {
      title: typeof title === 'string' ? title : undefined,
      rows: pairs(Reflect.get(o, 'rows'), ['label', 'value']),
    },
  }
}

export async function uiRunMenu(url: string, api: RunMenuApi): Promise<MenuOutput | undefined> {
  const mod = await loadUi(url)
  if (!mod.runMenu) throw new Error('右クリックメニューの項目を実行する関数（runMenu）が見つかりません')
  return menuOutputOf(await mod.runMenu(api))
}

/** ファイルが指す URL。http か https でなければ undefined。 */
export async function uiLink(url: string, api: Api): Promise<string | undefined> {
  const mod = await loadUi(url)
  if (!mod.link) throw new Error('URL を読む関数（link）が見つかりません')
  const u = await mod.link(api)
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : undefined
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
  return pairs(await links.details(api), ['label', 'value'])
}

/** 区間を作るのを待つ長さ。長い動画では数百回シークする。 */
const CONTENT_LIMIT = 600_000

/** stop が中止になるか、時間の上限を過ぎると、signal で止めてもらう。 */
export async function uiExcerpt(
  url: string,
  api: Omit<ExcerptApi, 'budget' | 'signal'>,
  budget: ExcerptBudget,
  stop: AbortSignal,
): Promise<ExcerptPart[]> {
  const mod = await loadUi(url)
  if (!mod.excerpt) throw new Error('区間を作る関数（excerpt）が見つかりません')
  const late = AbortSignal.timeout(CONTENT_LIMIT)
  const signal = AbortSignal.any([stop, late])
  const parts = await mod.excerpt({ ...api, budget, signal })
  if (late.aborted) throw new Error(`区間の作成が ${CONTENT_LIMIT / 1000} 秒以内に終わりませんでした`)
  return Array.isArray(parts) ? parts : []
}
