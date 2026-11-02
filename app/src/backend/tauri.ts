import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
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
  MenuEntry,
  Part,
  PluginReport,
  PluginSource,
  SettingValue,
  UiRef,
} from '../plugins/types'
import type { Caller, ContentBudget, ContentPart, OwnApi } from '../../plugins/sdk'
import {
  EDGE,
  ThumbnailTimeout,
  type UiApi,
  type UiItem,
  uiContent,
  uiDetails,
  uiMenu,
  uiRunMenu,
  uiThumbnail,
  uiWaveform,
} from '../plugins/ui'
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
  KnownLibrary,
  SavedTabs,
  Suggestions,
  UnusedPlugin,
} from './types'

type TauriItem = StoredItem & { file: string; thumb?: string }

const urlsOf = (it: TauriItem): ItemUrls => ({
  src: it.note ? undefined : convertFileSrc(it.file),
  thumb: it.thumb && convertFileSrc(it.thumb),
})

type TauriView = { kind: 'image' | 'video' | 'audio' | 'decoded' } | { kind: 'ui'; plugin: string; module: string }

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

/** 波形を作る時間の上限（秒）の設定の key。src-tauri/src/plugin/mod.rs の WAVEFORM_LIMIT_KEY と合わせる。 */
const WAVE_LIMIT = '@waveformLimit'

const at = (p: { x: number; y: number }) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio })

const callerOf = <M extends object>(item: UiItem, part: Part, plugin?: string): Caller<M> => ({
  call: async (method: string, ...args: unknown[]) => {
    const r = await invoke<string>('plugin_call', {
      id: item.id,
      part,
      plugin,
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
async function packParts(parts: ContentPart[]) {
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

  let decoded: string | undefined

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

  const uiApi = (item: UiItem, part: Part, plugin: string): UiApi => ({
    item,
    read: async (offset, length) =>
      new Uint8Array(await invoke<ArrayBuffer>('plugin_read', { id: item.id, offset, length })),
    ...callerOf(item, part),
    plugin: (dep) => callerOf(item, part, dep),
    ...ownApi(plugin),
  })

  const menuApi = (e: Elevated) => ({
    ...ownApi(e.plugin),
    targets: e.items.map((it) => uiApi(uiItemOf(it), 'menu', e.plugin)),
  })

  const elevatedMenu = async (ids: string[], e: Elevated): Promise<MenuEntry[]> =>
    uiMenu(pluginUrl(e.plugin, e.module), {
      ...menuApi(e),
      sandbox: () => invoke('sandbox_menu', { ids }),
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

  const makeUiThumb = async (it: TauriItem, ui: UiRef) => {
    const read = new Set<string>()
    const api = uiApi(uiItemOf(it), 'thumbnail', ui.plugin)
    const t = await uiThumbnail(pluginUrl(ui.plugin, ui.module), {
      ...api,
      settings: async () => watched(await api.settings(), read),
      sandbox: () => sandboxThumbnail(it.id),
    }).catch((e: unknown) => {
      if (!(e instanceof ThumbnailTimeout)) throw e
      console.warn(`サムネイルが ${e.ms / 1000} 秒で作り終わらない: ${it.name}.${it.ext}`)
      sendThumb(it.id, { failed: true })
      return null
    })
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
    uiQueue.push(...items.filter((it) => !it.note && !it.thumb && formats.get(it.ext)?.uiThumbnail))
    if (making) return
    try {
      for (let it = nextUi(); it; it = nextUi()) {
        making = it
        const ui = formats.get(it.ext)?.uiThumbnail
        if (!ui) continue
        try {
          await makeUiThumb(it, ui)
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
  const makeWave = async (it: TauriItem, ui: UiRef) => {
    const limit = (await invoke<Record<string, SettingValue>>('plugin_settings', { plugin: ui.plugin }))[WAVE_LIMIT]
    const api = uiApi(uiItemOf(it), 'waveform', ui.plugin)
    const wave = await uiWaveform(
      pluginUrl(ui.plugin, ui.module),
      api,
      typeof limit === 'number' ? limit * 1000 : 60_000,
    )
    if (wave) await invoke('put_waveform', wave, { headers: { id: it.id } })
  }
  const makeWaves = async (items: TauriItem[]) => {
    const want = items.filter((it) => !it.note && !waveIds.has(it.id) && formats.get(it.ext)?.uiWaveform)
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
        const ui = formats.get(it.ext)?.uiWaveform
        try {
          if (ui) await makeWave(it, ui)
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
  let contentBudget: ContentBudget | undefined
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
          const parts = await uiContent(
            pluginUrl(w.plugin, w.module),
            { ...uiApi(uiItemOf(w), 'content', w.plugin), sandbox: () => invoke('content_sandbox', { job: w.job }) },
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
    (listeningContent ??= listen<{ items: ContentWanted[]; budget?: ContentBudget }>('content-wanted', (e) => {
      contentStop.abort()
      contentStop = new AbortController()
      contentQueue = [...e.payload.items]
      contentBudget = e.payload.budget
      void makeContents()
    }))

  const openedOf = (s: StoredLibrary<TauriItem>) => {
    formats = new Map(s.formats.map((f) => [f.ext, f]))
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
      return { thumbnails, waveforms: idsOf([...waveQueue, waving]) }
    },
    async stopPluginWork(part) {
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
      const off = getCurrentWebview().onDragDropEvent(async (e) => {
        const p = e.payload
        if (p.type === 'enter') {
          dropped = p.paths
          send({ type: 'enter', dropped: await invoke<Dropped>('inspect_drop', { paths: p.paths }) })
        } else if (p.type === 'over') send({ type: 'over', ...at(p.position) })
        else if (p.type === 'drop') {
          dropped = p.paths
          send({ type: 'drop', ...at(p.position) })
        } else send({ type: 'leave' })
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
      async install() {
        const local = await invoke<string | null>('pick_plugin')
        if (!local) return false
        const source: PluginSource = { local }
        await invoke('install_plugin', { source })
        return true
      },
      update: (id) => invoke('update_plugin', { id }),
      remove: (id) => invoke('remove_plugin', { id }),
      setEnabled: (id, dev, enabled) => invoke('set_plugin_enabled', { id, dev, enabled }),
      setSetting,
    },
    async itemView(id) {
      if (decoded) URL.revokeObjectURL(decoded)
      decoded = undefined
      const v = await invoke<TauriView | null>('item_view', { id })
      if (!v) return null
      if (v.kind === 'ui') return { kind: 'ui', plugin: v.plugin, url: pluginUrl(v.plugin, v.module) }
      if (v.kind !== 'decoded') return { kind: v.kind }
      const png = await invoke<ArrayBuffer>('item_decoded', { id })
      decoded = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      return { kind: 'image', url: decoded }
    },
    async itemDetails(id) {
      const d = await invoke<ItemDetails & { elevated?: Elevated }>('item_details', { id })
      return d.elevated ? elevatedDetails(d, d.elevated) : d
    },
    revealItem: (id) => invoke('reveal_item', { id }),
    openItemDefault: (id) => invoke('open_item_default', { id }),
    itemPath: (id) => invoke('item_path', { id }),
    async itemMenu(ids) {
      const m = await invoke<{ items: MenuEntry[]; elevated?: Elevated }>('item_menu', { ids })
      return m.elevated ? elevatedMenu(ids, m.elevated) : m.items
    },
    async runItemMenu(ids, entry) {
      const r = await invoke<{ message: string | null; elevated?: Elevated }>('run_item_menu', { ids, entry })
      if (!r.elevated) return r.message ?? undefined
      const e = r.elevated
      return uiRunMenu(pluginUrl(e.plugin, e.module), {
        ...menuApi(e),
        id: entry,
        sandbox: async () => (await invoke<string | null>('sandbox_run_menu', { ids, entry })) ?? undefined,
      })
    },
    async waveform(id) {
      const wave = new Uint8Array(await invoke<ArrayBuffer>('waveform', { id }))
      return wave.length > 0 ? wave : null
    },
    uiApi,
    uiUrl: (ui) => pluginUrl(ui.plugin, ui.module),
  }
}
