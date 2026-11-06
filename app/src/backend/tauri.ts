import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { FROM_WINDOW, type FromWindow } from '../window/protocol'
import {
  type ItemUrls,
  type StoredChanged,
  type StoredGroup,
  type StoredItem,
  type StoredLibrary,
  type StoredProject,
  toChanged,
  toGroup,
  toItem,
  toOpened,
  toProject,
} from './stored'
import type { Thumbnail } from '../model/library'
import type {
  FormatInfo,
  ItemDetails,
  LinkInfo,
  MenuEntry,
  MenuGroup,
  MenuOutput,
  CapPart,
  PluginReport,
  PluginSource,
  SettingValue,
  UiRef,
} from '../plugins/types'
import type { Caller, ExcerptBudget, ExcerptPart, Fetched, LinkApi, OwnApi } from '../../plugins/sdk'
import { handlerOf, iconThumbnail, imageThumbnail, pageOf, pageRows } from '../plugins/links'
import {
  EDGE,
  ThumbnailTimeout,
  type UiApi,
  type UiItem,
  uiExcerpt,
  uiDetails,
  uiLink,
  uiLinkDetails,
  uiLinkThumbnail,
  uiMenu,
  uiRunMenu,
  uiThumbnail,
} from '../plugins/ui'
import { waveform } from '../media/waveform'
import type {
  AutoTag,
  AutoTagProgress,
  Backend,
  CacheUsage,
  Changed,
  ContentHit,
  AppSettings,
  Developer,
  Dropped,
  FileDrag,
  HookFailed,
  KnownLibrary,
  MenuResult,
  PageAt,
  SavedTabs,
  Suggestions,
  UnusedPlugin,
} from './types'

type TauriItem = StoredItem & { file: string; thumb?: string }

const urlsOf = (it: TauriItem): ItemUrls => ({
  src: it.note ? undefined : convertFileSrc(it.file),
  thumb: it.thumb && convertFileSrc(it.thumb),
})

type TauriView =
  | { kind: 'image' | 'video' | 'audio' | 'decoded' }
  | { kind: 'ui' | 'link'; plugin: string; module: string }

/** プラグインを読み直した回数。組み込み UI の ES モジュールは URL ごとに使い回すので、URL に付けて読み直させる。 */
let uiVersion = 0

const pluginUrl = (plugin: string, path: string) =>
  `${convertFileSrc('', 'plugin') + [plugin, ...path.split('/')].map(encodeURIComponent).join('/')}?v=${uiVersion}`

const watched = (s: Record<string, SettingValue>, read: Set<string>) =>
  new Proxy(s, {
    get(t, k) {
      if (typeof k === 'string' && Object.hasOwn(t, k)) read.add(k)
      return Reflect.get(t, k)
    },
    ownKeys(t) {
      for (const k of Object.keys(t)) read.add(k)
      return Reflect.ownKeys(t)
    },
  })

/** 見出しに載せられるよう、ASCII でない文字を \uXXXX にした JSON。 */
const asciiJson = (v: unknown) =>
  JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/** Rust が elevated に回してきた素材。 */
interface ElevatedItem {
  id: string
  name: string
  ext: string
  file: string
}

interface Elevated extends UiRef {
  items: ElevatedItem[]
}

const uiItemOf = (it: ElevatedItem): UiItem => ({ id: it.id, name: it.name, ext: it.ext, url: convertFileSrc(it.file) })

const at = (p: { x: number; y: number }) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio })

/** owner は呼ぶ元のプラグイン。右クリックメニューは拡張子と別に決まるので、これで WASM を選ぶ。 */
const callerOf = <M extends object>(item: UiItem, part: CapPart, owner: string, plugin?: string): Caller<M> => ({
  call: async (method: string, ...args: unknown[]) => {
    const r = await invoke<string>('plugin_call', {
      id: item.id,
      part,
      plugin,
      owner,
      method,
      args: JSON.stringify(args[0] ?? null),
    })
    return r === '' ? undefined : JSON.parse(r)
  },
})

const bytesOf = async (b: Blob | ArrayBuffer | Uint8Array) =>
  b instanceof Uint8Array ? b : new Uint8Array(b instanceof Blob ? await b.arrayBuffer() : b)

/**
 * Rust に渡す区間。頭の 4 バイトが区間の形の JSON の長さで、JSON、中身と続く。
 * 形は src-tauri/src/content.rs の SentPart と合わせる。
 */
async function packParts(parts: ExcerptPart[]) {
  const chunks: Uint8Array[] = []
  const sent = []
  for (const p of parts) {
    const images = await Promise.all((p.images ?? []).map(bytesOf))
    const audio = p.audio && (await bytesOf(p.audio))
    chunks.push(...images, ...(audio ? [audio] : []))
    sent.push({ start: p.start, end: p.end, images: images.map((b) => b.length), audio: audio?.length, text: p.text })
  }
  const head = new TextEncoder().encode(JSON.stringify(sent))
  const out = new Uint8Array(4 + head.length + chunks.reduce((n, c) => n + c.length, 0))
  new DataView(out.buffer).setUint32(0, head.length, true)
  out.set(head, 4)
  let pos = 4 + head.length
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

/** 頭の 8 バイトは素材の幅と高さ（わからなければ 0）。src-tauri/src/lib.rs の sandbox_thumbnail と合わせる。 */
const sandboxThumbnail = async (id: string) => {
  const b = new Uint8Array(await invoke<ArrayBuffer>('sandbox_thumbnail', { id, edge: EDGE }))
  if (!b.length) return null
  const v = new DataView(b.buffer, b.byteOffset, 8)
  const [width, height] = [v.getUint32(0, true), v.getUint32(4, true)]
  return { png: b.subarray(8), ...(width && height && { width, height }) }
}

const putContent = async (job: number, body: Uint8Array, headers: Record<string, string>) => {
  await invoke('put_content', body, { headers: { job: `${job}`, ...headers } }).catch((e: unknown) =>
    console.warn('区間を渡せない', e),
  )
}

/** 頭の 4 バイトが見出しの JSON の長さで、JSON、中身と続く。src-tauri/src/web.rs の fetch と合わせる。 */
const fetchVia = async (plugin: string | undefined, url: string): Promise<Fetched> => {
  const b = new Uint8Array(await invoke<ArrayBuffer>('plugin_fetch', { plugin: plugin ?? null, url }))
  const n = new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true)
  const head: { status: number; url: string; type?: string } = JSON.parse(
    new TextDecoder().decode(b.subarray(4, 4 + n)),
  )
  return { ...head, body: b.slice(4 + n) }
}

/** 本体が取りに行く（どの links にも当てはまらない URL の OGP など）。 */
const hostFetch = (u: string) => fetchVia(undefined, u)

const idsOf = (xs: (TauriItem | undefined)[]) => xs.flatMap((it) => (it ? [it.id] : []))

export function tauriBackend(): Backend {
  // 開いた直後からサムネイルが届くので、画面が受け取れるようになるまで溜めておく
  const ready: [string, Thumbnail][] = []
  const subs = new Set<(id: string, thumb: Thumbnail) => void>()
  const thumbed = new Set<string>()
  const sendThumb = (id: string, t: Thumbnail) => {
    thumbed.add(id)
    if (subs.size) for (const cb of subs) cb(id, t)
    else ready.push([id, t])
  }
  let listening: Promise<unknown> | undefined
  const listenThumbs = () =>
    (listening ??= listen<{ id: string; file: string; width: number; height: number; wave: boolean }>(
      'thumbnail',
      (e) => {
        const p = e.payload
        sendThumb(p.id, { url: convertFileSrc(p.file), ratio: p.width / p.height, wave: p.wave })
      },
    ))
  // 写しから開いたあとの突き合わせの結果も、画面が受け取れるようになるまで溜めておく
  const changes: Changed[] = []
  const changeSubs = new Set<(c: Changed) => void>()
  let listeningChanges: Promise<unknown> | undefined
  const listenChanges = () =>
    (listeningChanges ??= listen<StoredChanged<TauriItem>>('library-changed', (e) => {
      const c = toChanged(e.payload, new Date(), formats, urlsOf)
      const items = e.payload.items.toSorted((a, b) => b.mtime - a.mtime)
      void makeUiThumbs(items)
      void makeWaves(items)
      if (changeSubs.size) for (const cb of changeSubs) cb(c)
      else changes.push(c)
    }))
  let formats = new Map<string, FormatInfo>()
  let links = new Map<string, LinkInfo>()
  // 前に開いていた画面が出した外のページは、読み直すと持ち主がいなくなる
  void invoke('browser_close_all').catch((e: unknown) => console.warn('外のページを閉じられない', e))

  // 落としたもののパスは画面に渡さず、取り込むときまでここで持つ
  let dropped: string[] = []

  const setSetting = async (plugin: string, key: string, value: SettingValue) => {
    void makeUiThumbs(await invoke<TauriItem[]>('set_plugin_setting', { id: plugin, key, value }))
  }

  const ownApi = (plugin: string): OwnApi => ({
    settings: () => invoke('plugin_settings', { plugin }),
    setSetting: (key, value) => setSetting(plugin, key, value),
    getData: async (key) => (await invoke<string | null>('plugin_data', { plugin, key })) ?? undefined,
    setData: (key, value) => invoke('set_plugin_data', { plugin, key, value: value ?? null }),
  })

  const uiApi = (item: UiItem, part: CapPart, plugin: string): UiApi => ({
    item,
    read: async (offset, length) =>
      new Uint8Array(await invoke<ArrayBuffer>('plugin_read', { id: item.id, offset, length })),
    ...callerOf(item, part, plugin),
    plugin: (dep) => callerOf(item, part, plugin, dep),
    ...ownApi(plugin),
  })

  const linkApi = (url: string, plugin: string): LinkApi => ({
    url,
    fetch: (u) => fetchVia(plugin, u),
    ...ownApi(plugin),
  })

  /** 素材が指す URL。ui は link を受け持つもの。 */
  const readLink = (item: UiItem, ui: UiRef) => uiLink(pluginUrl(ui.plugin, ui.module), uiApi(item, 'link', ui.plugin))

  const linkThumbs = new Map<string, Promise<Blob | undefined>>()
  const windowListeners = new Set<(m: FromWindow) => void>()
  const linkThumbnail = async (url: string) => {
    const h = handlerOf(links, url)
    if (h?.parts.includes('thumbnail')) return uiLinkThumbnail(pluginUrl(h.plugin, h.module), linkApi(url, h.plugin))
    const p = await pageOf(url, hostFetch)
    const image = p.image && (await imageThumbnail(p.image, hostFetch, EDGE).catch(() => null))
    return image || iconThumbnail(p, hostFetch, EDGE)
  }

  const linkDetails = async (d: ItemDetails, e: Elevated): Promise<ItemDetails> => {
    const [it] = e.items
    const url = it && (await readLink(uiItemOf(it), e).catch(() => undefined))
    if (!url) return d
    const h = handlerOf(links, url)
    const rows = await (
      h?.parts.includes('details')
        ? uiLinkDetails(pluginUrl(h.plugin, h.module), linkApi(url, h.plugin))
        : pageOf(url, hostFetch).then(pageRows)
    ).catch((err: unknown) => {
      console.warn(`URL の詳細を足せない: ${url}`, err)
      return []
    })
    return { size: d.size, rows, url }
  }

  interface MenuDone {
    output: MenuOutput | null
    copy: string | null
    items: TauriItem[]
    saved?: string
    failed: string[]
  }

  const menuResultOf = (d: MenuDone): MenuResult => {
    void makeUiThumbs(d.items)
    void makeWaves(d.items)
    const now = new Date()
    return {
      output: d.output ?? undefined,
      copy: d.copy ?? undefined,
      items: d.items.map((it) => toItem(it, now, formats, urlsOf(it))),
      saved: d.saved,
      failed: d.failed,
    }
  }

  const menuApi = (e: Elevated) => ({
    ...ownApi(e.plugin),
    targets: e.items.map((it) => uiApi(uiItemOf(it), 'menu', e.plugin)),
  })

  const elevatedMenu = async (ids: string[], e: Elevated): Promise<MenuEntry[]> =>
    uiMenu(pluginUrl(e.plugin, e.module), {
      ...menuApi(e),
      sandbox: () => invoke('sandbox_menu', { ids, plugin: e.plugin }),
    })

  const elevatedDetails = async (d: ItemDetails, e: Elevated): Promise<ItemDetails> => {
    const [it] = e.items
    if (!it) return d
    const rows = await uiDetails(pluginUrl(e.plugin, e.module), {
      ...uiApi(uiItemOf(it), 'details', e.plugin),
      sandbox: () => invoke('sandbox_details', { id: it.id }),
    }).catch((err: unknown) => {
      console.warn(`ファイルの詳細を足せない: ${it.name}.${it.ext}`, err)
      return []
    })
    return { size: d.size, rows }
  }

  const lateThumb = (it: TauriItem) => (e: unknown) => {
    if (!(e instanceof ThumbnailTimeout)) throw e
    console.warn(`サムネイルが ${e.ms / 1000} 秒で作り終わらない: ${it.name}.${it.ext}`)
    sendThumb(it.id, { failed: true })
    return null
  }

  const makeLinkThumb = async (it: TauriItem, ui: UiRef) => {
    const url = await readLink(uiItemOf(it), ui)
    const t = url && (await linkThumbnail(url).catch(lateThumb(it)))
    if (!t) return
    const headers: Record<string, string> = { id: it.id }
    if (t.width && t.height) Object.assign(headers, { width: `${t.width}`, height: `${t.height}` })
    const png = t.png instanceof Uint8Array ? t.png : new Uint8Array(await new Response(t.png).arrayBuffer())
    await invoke('put_thumbnail', png, { headers })
  }

  const makeUiThumb = async (it: TauriItem, ui: UiRef) => {
    const read = new Set<string>()
    const api = uiApi(uiItemOf(it), 'thumbnail', ui.plugin)
    const t = await uiThumbnail(pluginUrl(ui.plugin, ui.module), {
      ...api,
      settings: async () => watched(await api.settings(), read),
      sandbox: () => sandboxThumbnail(it.id),
    }).catch(lateThumb(it))
    if (!t) return
    const headers: Record<string, string> = { id: it.id, settings: asciiJson([...read]) }
    if (t.width && t.height) Object.assign(headers, { width: `${t.width}`, height: `${t.height}` })
    await invoke('put_thumbnail', t.png, { headers })
  }

  // 組み込み UI が作るサムネイルは、画面で 1 つずつ作って Rust に置かせる（できたら thumbnail が届く）
  const uiQueue: TauriItem[] = []
  let making: TauriItem | undefined
  let seen = new Set<string>()
  const nextUi = () => {
    const i = uiQueue.findIndex((it) => seen.has(it.id))
    return uiQueue.splice(Math.max(i, 0), 1)[0]
  }
  const makeUiThumbs = async (items: TauriItem[]) => {
    const byUi = (it: TauriItem) => {
      const f = formats.get(it.ext)
      return f?.uiThumbnail ?? f?.uiLink
    }
    uiQueue.push(...items.filter((it) => !it.note && !it.thumb && byUi(it)))
    if (making) return
    try {
      for (let it = nextUi(); it; it = nextUi()) {
        making = it
        const f = formats.get(it.ext)
        try {
          if (f?.uiThumbnail) await makeUiThumb(it, f.uiThumbnail)
          else if (f?.uiLink) await makeLinkThumb(it, f.uiLink)
        } catch (e) {
          console.warn(`サムネイルを作れない: ${it.name}.${it.ext}`, e)
        }
      }
    } finally {
      making = undefined
    }
  }

  // 波形は、画面で 1 つずつ作って Rust に置かせる。サムネイルがまだなければ、Rust が波形を描いてサムネイルにする
  const waveQueue: TauriItem[] = []
  const waveIds = new Set<string>()
  let waving: TauriItem | undefined
  const makeWave = async (it: TauriItem) => {
    const { waveLimit } = await invoke<AppSettings>('app_settings')
    const read = async (offset: number, length: number) =>
      new Uint8Array(await invoke<ArrayBuffer>('plugin_read', { id: it.id, offset, length }))
    const wave = await waveform(it.ext, read, waveLimit * 1000)
    await invoke('put_waveform', wave, { headers: { id: it.id } })
  }
  const makeWaves = async (items: TauriItem[]) => {
    const want = items.filter((it) => !it.note && !waveIds.has(it.id) && formats.get(it.ext)?.media === 'audio')
    if (!want.length) return
    const missing = new Set(await invoke<string[]>('missing_waveforms', { ids: want.map((it) => it.id) }))
    for (const it of want)
      if (missing.has(it.id) && !waveIds.has(it.id)) {
        waveIds.add(it.id)
        waveQueue.push(it)
      }
    if (waving) return
    try {
      for (let it = waveQueue.shift(); it; it = waveQueue.shift()) {
        waving = it
        try {
          await makeWave(it)
        } catch (e) {
          console.warn(`波形を作れない: ${it.name}.${it.ext}`, e)
          if (!it.thumb && !thumbed.has(it.id)) sendThumb(it.id, { failed: true })
        } finally {
          waveIds.delete(it.id)
        }
      }
    } finally {
      waving = undefined
    }
  }

  // 自動分類で読む区間のうち、elevated が受け持つもの。Rust が頼んできたものを 1 つずつ作って返す
  interface ContentWanted extends ElevatedItem, UiRef {
    job: number
  }
  let contentQueue: ContentWanted[] = []
  let contentStop = new AbortController()
  let contentBudget: ExcerptBudget | undefined
  let contenting = false
  const makeContents = async () => {
    if (contenting) return
    contenting = true
    try {
      for (let w = contentQueue.shift(); w; w = contentQueue.shift()) {
        const budget = contentBudget
        if (!budget) break
        const started = performance.now()
        const ms = () => `${performance.now() - started}`
        try {
          const parts = await uiExcerpt(
            pluginUrl(w.plugin, w.module),
            { ...uiApi(uiItemOf(w), 'excerpt', w.plugin), sandbox: () => invoke('content_sandbox', { job: w.job }) },
            budget,
            contentStop.signal,
          )
          await putContent(w.job, await packParts(parts), { ms: ms() })
        } catch (e) {
          await putContent(w.job, new Uint8Array(), {
            error: asciiJson(e instanceof Error ? e.message : String(e)),
            ms: ms(),
          })
        }
      }
    } finally {
      contenting = false
    }
  }
  let listeningContent: Promise<unknown> | undefined
  let suggestions: Suggestions | undefined
  const suggestionSubs = new Set<(s: Suggestions) => void>()
  let listeningSuggestions: Promise<unknown> | undefined
  const listenSuggestions = () =>
    (listeningSuggestions ??= listen<Suggestions>('suggestions-changed', (e) => {
      suggestions = e.payload
      for (const cb of suggestionSubs) cb(e.payload)
    }))

  const listenContent = () =>
    (listeningContent ??= listen<{ items: ContentWanted[]; budget?: ExcerptBudget }>('content-wanted', (e) => {
      contentStop.abort()
      contentStop = new AbortController()
      contentQueue = [...e.payload.items]
      contentBudget = e.payload.budget
      void makeContents()
    }))

  const openedOf = (s: StoredLibrary<TauriItem>) => {
    formats = new Map(s.formats.map((f) => [f.ext, f]))
    links = new Map((s.links ?? []).map((l) => [l.host, l]))
    const items = s.items.toSorted((a, b) => b.mtime - a.mtime)
    void makeUiThumbs(items)
    void makeWaves(items)
    return toOpened(s, new Date(), urlsOf)
  }
  const stopFront = () => {
    uiQueue.length = 0
    for (const it of waveQueue.splice(0)) waveIds.delete(it.id)
  }
  const frontBusy = () => !!(making || waving)
  const frontIdle = async () => {
    while (frontBusy()) await new Promise((r) => setTimeout(r, 50))
  }

  return {
    async open() {
      suggestions = undefined
      await Promise.all([listenThumbs(), listenChanges(), listenContent(), listenSuggestions()])
      for (const it of waveQueue.splice(0)) waveIds.delete(it.id)
      return openedOf(await invoke<StoredLibrary<TauriItem>>('open_library'))
    },
    async pluginWork() {
      const thumbnails = [...new Set([...idsOf([...uiQueue, making]), ...(await invoke<string[]>('plugin_work'))])]
      return { thumbnails, waveforms: idsOf([...waveQueue, waving]), hooks: await invoke<string[]>('hook_work') }
    },
    onHookFailed(fn) {
      const off = listen<HookFailed>('hook-failed', (e) => fn(e.payload))
      return () => void off.then((f) => f())
    },
    async stopPluginWork(part) {
      if (part === 'hook') return invoke('stop_hooks')
      if (part !== 'thumbnail') for (const it of waveQueue.splice(0)) waveIds.delete(it.id)
      if (part === 'waveform') return
      uiQueue.length = 0
      await invoke('stop_plugin_work')
    },
    seenThumbs(ids) {
      seen = new Set(ids)
      void invoke('seen_thumbs', { ids })
    },
    checking: () => invoke<boolean>('checking'),
    async reloadPlugins(wait) {
      if (!wait) stopFront()
      await frontIdle()
      const s = await invoke<StoredLibrary<TauriItem>>('reload_plugins', { wait })
      uiVersion++
      return openedOf(s)
    },
    async saveItem(id, patch) {
      const it = await invoke<TauriItem | null>('save_item', { id, patch })
      return it ? toItem(it, new Date(), formats, urlsOf(it)) : undefined
    },
    async moveItem(id, place) {
      const it = await invoke<TauriItem>('move_item', { id, place })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    async renameItem(id, name) {
      const it = await invoke<TauriItem>('rename_item', { id, name })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    deleteItem: (id) => invoke('delete_item', { id }),
    saveState: (state) => invoke('save_state', { state }),
    tagHistory: () => invoke<string[]>('tag_history'),
    saveTagHistory: (tags) => invoke('save_tag_history', { tags }),
    openHistory: () => invoke<string[]>('open_history'),
    saveOpenHistory: (ids) => invoke('save_open_history', { ids }),
    tabs: async () => (await invoke<SavedTabs | null>('tabs')) ?? undefined,
    saveTabs: (tabs) => invoke('save_tabs', { tabs }),
    async createNote(name, place) {
      const it = await invoke<TauriItem>('create_note', { name, place })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    async createProject(name) {
      return toProject(await invoke<StoredProject>('create_project', { name }), new Date())
    },
    saveProject: (name, cover) => invoke('save_project', { name, cover }),
    renameProject: (from, to) => invoke('rename_project', { from, to }),
    deleteProject: (name) => invoke('delete_project', { name }),
    saveTagCover: (tag, cover) => invoke('save_tag_cover', { tag, cover }),
    renameTag: (from, to, keepFrom) => invoke('rename_tag', { from, to, keepFrom }),
    deleteTagCover: (tag) => invoke('delete_tag_cover', { tag }),
    relinkMeta: (meta, to) => invoke('relink_meta', { meta, to }),
    discardMeta: (meta) => invoke('discard_meta', { meta }),
    chooseLibrary: () => invoke<boolean>('choose_library'),
    libraries: {
      list: () => invoke<KnownLibrary[]>('libraries'),
      switch: (path) => invoke('switch_library', { path }),
      forget: (path) => invoke('forget_library', { path }),
    },
    tidy: {
      usage: () => invoke<CacheUsage>('cache_usage'),
      clear: (kind) => invoke('clear_cache', { kind }),
      unusedPlugins: () => invoke<UnusedPlugin[]>('unused_plugins'),
      removeUnusedPlugins: () => invoke('remove_unused_plugins'),
    },
    developer: {
      get: () => invoke<Developer>('developer'),
      set: (developer) => invoke('set_developer', { developer }),
      pick: async (kind) => (await invoke<string | null>('pick_dev_path', { repo: kind === 'repo' })) ?? undefined,
    },
    appSettings: {
      get: () => invoke<AppSettings>('app_settings'),
      set: (settings) => invoke('set_app_settings', { settings }),
      pickCommand: async (name) => (await invoke<string | null>('pick_command', { name })) ?? undefined,
    },
    contentSearch: {
      prepare: () => invoke('prepare_content_search'),
      search: (query) => invoke<ContentHit[]>('search_content', { query }),
    },
    tagDecisions: {
      record: (item, chosen, rejected) => invoke('record_tags', { item, chosen, rejected }),
      undo: (item) => invoke('undo_tags', { item }),
      suggestTags: (id) => invoke<string[]>('suggest_tags', { id }),
      onSuggestions(cb) {
        suggestionSubs.add(cb)
        if (suggestions) cb(suggestions)
        return () => void suggestionSubs.delete(cb)
      },
    },
    autoTag: {
      get: () => invoke<AutoTag>('auto_tag'),
      set: (on) => invoke('set_auto_tag', { on }),
      cancelDownload: () => invoke('cancel_auto_tag_download'),
      setSuggest: (mode) => invoke('set_tag_suggest', { mode }),
      setSearch: (on) => invoke('set_content_search', { on }),
      onProgress(cb) {
        const off = listen<AutoTagProgress>('auto-tag-progress', (e) => cb(e.payload))
        return () => void off.then((f) => f())
      },
    },
    onFileDrag(cb) {
      const send = (e: FileDrag) => cb(e)
      let turn = 0
      let inspecting: Promise<Dropped> | undefined
      const off = getCurrentWebview().onDragDropEvent(async (e) => {
        const p = e.payload
        if (p.type === 'enter') {
          const mine = ++turn
          dropped = p.paths
          inspecting = invoke<Dropped>('inspect_drop', { paths: p.paths })
          const info = await inspecting
          if (mine === turn) send({ type: 'enter', dropped: info })
        } else if (p.type === 'over') send({ type: 'over', ...at(p.position) })
        else if (p.type === 'drop') {
          turn++
          dropped = p.paths
          const info = await (inspecting ?? invoke<Dropped>('inspect_drop', { paths: p.paths }))
          inspecting = undefined
          send({ type: 'drop', ...at(p.position), dropped: info })
        } else {
          turn++
          inspecting = undefined
          send({ type: 'leave' })
        }
      })
      return () => void off.then((f) => f())
    },
    async importDropped(place) {
      const r = await invoke<{ items: TauriItem[]; groups: StoredGroup[]; skipped: number; failed: string[] }>(
        'import_files',
        { paths: dropped, place },
      )
      const now = new Date()
      void makeUiThumbs(r.items)
      void makeWaves(r.items)
      return {
        items: r.items.map((it) => toItem(it, now, formats, urlsOf(it))),
        groups: r.groups.map((g) => toGroup(g, now)),
        skipped: r.skipped,
        failed: r.failed,
      }
    },
    async importData(file, place) {
      const it = await invoke<TauriItem>('import_data', await file.arrayBuffer(), {
        headers: { meta: asciiJson([file.name, place]) },
      })
      void makeUiThumbs([it])
      void makeWaves([it])
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    onThumbnail(cb) {
      for (const [id, t] of ready.splice(0)) cb(id, t)
      subs.add(cb)
      return () => subs.delete(cb)
    },
    onChanged(cb) {
      for (const c of changes.splice(0)) cb(c)
      changeSubs.add(cb)
      return () => changeSubs.delete(cb)
    },
    plugins: () => invoke<PluginReport>('plugins'),
    pluginActions: {
      pickZip: async () => (await invoke<string | null>('pick_plugin')) ?? undefined,
      prepare: (source: PluginSource) => invoke('prepare_plugin', { source }),
      prepareUpdate: (id, tag) => invoke('prepare_update', { id, tag: tag ?? null }),
      commit: (token) => invoke('commit_plugin', { token }),
      cancel: (token) => invoke('cancel_plugin', { token }),
      latest: (id) => invoke('plugin_latest', { id }),
      setPrerelease: (id, prerelease) => invoke('set_plugin_prerelease', { id, prerelease }),
      remove: (id) => invoke('remove_plugin', { id }),
      setEnabled: (id, dev, enabled) => invoke('set_plugin_enabled', { id, dev, enabled }),
      setSetting,
    },
    async itemView(id) {
      const v = await invoke<TauriView | null>('item_view', { id })
      if (!v) return null
      if (v.kind === 'ui') return { kind: 'ui', plugin: v.plugin, url: pluginUrl(v.plugin, v.module) }
      if (v.kind === 'link') {
        const url = await readLink({ id, name: '', ext: '' }, v)
        return url ? { kind: 'link', url } : null
      }
      if (v.kind !== 'decoded') return { kind: v.kind }
      const png = await invoke<ArrayBuffer>('item_decoded', { id })
      return { kind: 'image', url: URL.createObjectURL(new Blob([png], { type: 'image/png' })) }
    },
    async itemDetails(id) {
      const d = await invoke<ItemDetails & { elevated?: Elevated; link?: Elevated }>('item_details', { id })
      if (d.link) return linkDetails(d, d.link)
      return d.elevated ? elevatedDetails(d, d.elevated) : d
    },
    revealItem: (id) => invoke('reveal_item', { id }),
    openItemDefault: (id) => invoke('open_item_default', { id }),
    exportFile: async (name, data) =>
      (await invoke<string | null>('export_data', new TextEncoder().encode(data), {
        headers: { name: asciiJson(name) },
      })) ?? undefined,
    itemPath: (id) => invoke('item_path', { id }),
    async itemMenu(ids) {
      const groups = await invoke<(MenuGroup & { elevated?: Elevated })[]>('item_menu', { ids })
      const all = await Promise.all(
        groups.map(async ({ plugin, items, elevated }): Promise<MenuGroup> => {
          if (!elevated) return { plugin, items }
          const made = await elevatedMenu(ids, elevated).catch((err: unknown) => {
            console.warn(`右クリックメニューの項目を作れない（${plugin}）`, err)
            return []
          })
          return { plugin, items: made }
        }),
      )
      return all.filter((g) => g.items.length > 0)
    },
    async runItemMenu(ids, plugin, entry) {
      const r = await invoke<MenuDone & { elevated?: Elevated }>('run_item_menu', { ids, plugin, entry })
      const e = r.elevated
      if (!e) return menuResultOf(r)
      // elevated の中で sandbox() が頼んだことも、まとめて返す
      const done: MenuResult = { items: [], failed: [] }
      const take = (d: MenuDone) => {
        const m = menuResultOf(d)
        done.copy = m.copy ?? done.copy
        done.saved = m.saved ?? done.saved
        done.items.push(...m.items)
        done.failed.push(...m.failed)
        return m.output
      }
      done.output = await uiRunMenu(pluginUrl(e.plugin, e.module), {
        ...menuApi(e),
        id: entry,
        sandbox: async () => take(await invoke<MenuDone>('sandbox_run_menu', { ids, plugin: e.plugin, entry })),
      })
      if (done.output && 'save' in done.output) {
        const { name, data } = done.output.save
        done.output = undefined
        const body = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
        const to = await invoke<string | null>('export_data', body, { headers: { name: JSON.stringify(name) } })
        done.saved = to ?? done.saved
      }
      return done
    },
    async waveform(id) {
      const wave = new Uint8Array(await invoke<ArrayBuffer>('waveform', { id }))
      return wave.length > 0 ? wave : null
    },
    uiApi,
    ownApi,
    uiUrl: (ui) => pluginUrl(ui.plugin, ui.module),
    linkOf(url, part) {
      const h = handlerOf(links, url)
      return {
        url,
        ui: h?.parts.includes(part) ? { url: pluginUrl(h.plugin, h.module), api: linkApi(url, h.plugin) } : undefined,
        page: () => pageOf(url, hostFetch),
      }
    },
    linkThumb(url) {
      let t = linkThumbs.get(url)
      if (!t) {
        t = linkThumbnail(url).then((x) =>
          x ? (x.png instanceof Blob ? x.png : new Blob([new Uint8Array(x.png)])) : undefined,
        )
        linkThumbs.set(url, t)
        t.catch(() => linkThumbs.delete(url))
      }
      return t.then((b) => b && URL.createObjectURL(b))
    },
    openUrl: (url) => invoke('open_url', { url }),
    browser: {
      show: (key, url, bounds) => invoke('browser_show', { key, url, bounds }),
      go: (key, to) => invoke('browser_go', { key, to }),
      layer: (layers) => invoke('browser_layer', { layers }),
      hide: (key) => invoke('browser_hide', { key }),
      close: (key) => invoke('browser_close', { key }),
      onMoved: (fn) => {
        const off = listen<PageAt & { key: string }>('browser-url', ({ payload: { key, ...page } }) => fn(key, page))
        return () => void off.then((f) => f())
      },
      onPopup: (fn) => {
        const off = listen<{ key: string; url: string }>('browser-popup', ({ payload }) => fn(payload.key, payload.url))
        return () => void off.then((f) => f())
      },
    },
    screenWindows: {
      async open(s) {
        const r = await invoke<{ label: string; existed: boolean }>('open_screen_window', {
          plugin: s.plugin,
          screen: s.id,
          title: s.label,
          width: s.window.width,
          height: s.window.height,
        })
        if (!r.existed) {
          const off = listen(
            'tauri://destroyed',
            () => {
              void off.then((f) => f())
              for (const fn of windowListeners) fn({ label: r.label, kind: 'closed' })
            },
            { target: { kind: 'Window', label: r.label } },
          )
        }
        return r
      },
      send: (label, event, payload) => emitTo(label, event, payload),
      listen: (fn) => {
        windowListeners.add(fn)
        const off = listen<FromWindow>(FROM_WINDOW, (e) => fn(e.payload))
        return () => {
          windowListeners.delete(fn)
          void off.then((f) => f())
        }
      },
      focusMain: () => {
        const w = getCurrentWindow()
        void w.unminimize().then(() => w.setFocus())
      },
    },
  }
}
