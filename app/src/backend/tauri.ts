import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  type ItemUrls,
  type StoredChanged,
  type StoredItem,
  type StoredLibrary,
  type StoredProject,
  toChanged,
  toItem,
  toOpened,
  toProject,
} from './stored'
import type { Thumbnail } from '../model/library'
import type { FormatInfo, Part, PluginReport, PluginSource, SettingValue, UiRef } from '../plugins/types'
import type { Caller } from '../../plugins/sdk'
import { ThumbnailTimeout, type UiApi, type UiItem, uiThumbnail, uiWaveform } from '../plugins/ui'
import errorThumb from './thumb-error.svg'
import type { Backend, CacheUsage, Changed, Developer, Dropped, FileDrag, KnownLibrary, UnusedPlugin } from './types'

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

const uiItemOf = (it: TauriItem): UiItem => ({ id: it.id, name: it.name, ext: it.ext, url: convertFileSrc(it.file) })

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
    (listening ??= listen<{ id: string; file: string; width: number; height: number }>('thumbnail', (e) => {
      const p = e.payload
      sendThumb(p.id, { url: convertFileSrc(p.file), ratio: p.width / p.height })
    }))
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

  const uiApi = (item: UiItem, part: Part, plugin: string): UiApi => ({
    item,
    read: async (offset, length) =>
      new Uint8Array(await invoke<ArrayBuffer>('plugin_read', { id: item.id, offset, length })),
    ...callerOf(item, part),
    plugin: (dep) => callerOf(item, part, dep),
    settings: () => invoke('plugin_settings', { plugin }),
    setSetting: (key, value) => setSetting(plugin, key, value),
    getData: async (key) => (await invoke<string | null>('plugin_data', { plugin, key })) ?? undefined,
    setData: (key, value) => invoke('set_plugin_data', { plugin, key, value: value ?? null }),
  })

  const makeUiThumb = async (it: TauriItem, ui: UiRef) => {
    const read = new Set<string>()
    const api = uiApi(uiItemOf(it), 'thumbnail', ui.plugin)
    const t = await uiThumbnail(pluginUrl(ui.plugin, ui.module), {
      ...api,
      settings: async () => watched(await api.settings(), read),
    }).catch((e: unknown) => {
      if (!(e instanceof ThumbnailTimeout)) throw e
      console.warn(`サムネイルが ${e.ms / 1000} 秒で作り終わらない: ${it.name}.${it.ext}`)
      sendThumb(it.id, { url: errorThumb, ratio: formats.get(it.ext)?.ratio ?? 1 })
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
  const makeUiThumbs = async (items: TauriItem[]) => {
    uiQueue.push(...items.filter((it) => !it.note && !it.thumb && formats.get(it.ext)?.uiThumbnail))
    if (making) return
    try {
      for (let it = uiQueue.shift(); it; it = uiQueue.shift()) {
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
          if (!it.thumb && !thumbed.has(it.id))
            sendThumb(it.id, { url: errorThumb, ratio: formats.get(it.ext)?.ratio ?? 1 })
        } finally {
          waveIds.delete(it.id)
        }
      }
    } finally {
      waving = undefined
    }
  }

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
      await Promise.all([listenThumbs(), listenChanges()])
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
    async moveItem(id, folder) {
      const it = await invoke<TauriItem>('move_item', { id, folder })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    async renameItem(id, name) {
      const it = await invoke<TauriItem>('rename_item', { id, name })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    deleteItem: (id) => invoke('delete_item', { id }),
    saveState: (state) => invoke('save_state', { state }),
    async createNote(name, folder) {
      const it = await invoke<TauriItem>('create_note', { name, folder })
      return toItem(it, new Date(), formats, urlsOf(it))
    },
    async createProject(name) {
      return toProject(await invoke<StoredProject>('create_project', { name }), new Date())
    },
    saveProject: (name, cover) => invoke('save_project', { name, cover }),
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
    async importDropped(folder, projects) {
      const r = await invoke<{ items: TauriItem[]; projects: StoredProject[]; skipped: number; failed: string[] }>(
        'import_files',
        { paths: dropped, folder, projects },
      )
      const now = new Date()
      void makeUiThumbs(r.items)
      void makeWaves(r.items)
      return {
        items: r.items.map((it) => toItem(it, now, formats, urlsOf(it))),
        projects: r.projects.map((p) => toProject(p, now)),
        skipped: r.skipped,
        failed: r.failed,
      }
    },
    async importData(file, folder) {
      const it = await invoke<TauriItem>('import_data', await file.arrayBuffer(), {
        headers: { meta: asciiJson([file.name, folder]) },
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
    itemDetails: (id) => invoke('item_details', { id }),
    revealItem: (id) => invoke('reveal_item', { id }),
    openItemDefault: (id) => invoke('open_item_default', { id }),
    itemPath: (id) => invoke('item_path', { id }),
    itemMenu: (id) => invoke('item_menu', { id }),
    runItemMenu: async (id, entry) => (await invoke<string | null>('run_item_menu', { id, entry })) ?? undefined,
    async waveform(id) {
      const wave = new Uint8Array(await invoke<ArrayBuffer>('waveform', { id }))
      return wave.length > 0 ? wave : null
    },
    uiApi,
    uiUrl: (ui) => pluginUrl(ui.plugin, ui.module),
  }
}
