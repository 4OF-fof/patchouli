import { type Accessor, createSignal, onCleanup } from 'solid-js'
import type { Backend, Dropped, Imported, Orphan } from '../backend'
import type { IconName } from '../components/base/Icon/Icon'
import type { NoteEditorApi } from '../components/editor/NoteEditor/NoteEditor'
import { watchSeen } from '../components/media/Thumb/Thumb'
import type { Activity } from '../components/nav/ActivityButton/ActivityButton'
import type { ToastLevel } from '../components/overlay/Toast/Toast'
import {
  type Library,
  type Place as ItemPlace,
  ROOT,
  type Suggestion,
  type Thumbnail,
  placeOf,
  withAdded,
  withChanged,
  withSuggestions,
  withThumbs,
} from '../model/library'
import type { TidyDecision } from '../screens/Tidy/TidyScreen'
import type { Tab, View } from './view'

const importedNotice = (r: Imported) => {
  const n = r.items.length
  const parts = [n ? `${n} 件を取り込みました` : '取り込めるファイルがありませんでした']
  if (r.groups.length) parts.push(`グループ ${r.groups.length} 件`)
  if (r.skipped) parts.push(`${r.skipped} 件はライブラリ内のファイルなどのためスキップ`)
  if (r.failed.length) parts.push(`${r.failed.length} 件のコピーに失敗`)
  return parts.join('、')
}

// 作り始めてから頼まれた素材を覚えておき、途中で増えたら total も増やす
function progress() {
  const [ids, setIds] = createSignal<ReadonlySet<string>>(new Set())
  const [seen, setSeen] = createSignal(0)
  let all = new Set<string>()
  const update = (now: string[]) => {
    if (!now.length) all = new Set()
    for (const id of now) all.add(id)
    if (now.length !== ids().size || now.some((id) => !ids().has(id))) setIds(new Set(now))
    setSeen(all.size)
  }
  return { ids, done: () => seen() - ids().size, total: seen, update }
}
type Progress = ReturnType<typeof progress>

export interface BackgroundDeps {
  backend: Backend
  lib: Accessor<Library>
  setLib: (l: Library) => void
  setPinnedProjects: (n: string[]) => void
  setPinnedTags: (t: string[]) => void
  setOrphans: (o: Orphan[]) => void
  setOrphansHeld: (held: boolean) => void
  tabs: Accessor<Tab[]>
  currentTab: Accessor<Tab>
  view: () => View
  peek: Accessor<string | undefined>
  editors: Map<number, NoteEditorApi>
  approveTags: (id: string, d: TidyDecision) => void
  forget: (ids: string[]) => void
  notify: (message: string, level: ToastLevel) => void
}

/** 裏で届くもの（サムネイル・提案・外での変更・ドロップ・プラグインの作業）を受けてライブラリに反映する。 */
export function createBackground(d: BackgroundDeps) {
  const { backend, lib, setLib, setPinnedProjects, setPinnedTags, setOrphans, setOrphansHeld } = d
  const { tabs, currentTab, view, peek, editors, approveTags, forget, notify } = d
  // サムネイルは 1 枚ずつ届くので、少し溜めてからまとめて付ける
  let thumbs = new Map<string, Thumbnail>()
  let flush = 0
  const stopThumbs = backend.onThumbnail((id, t) => {
    thumbs.set(id, t)
    flush ||= window.setTimeout(() => {
      setLib(withThumbs(lib(), thumbs))
      thumbs = new Map()
      flush = 0
    }, 150)
  })
  onCleanup(() => {
    stopThumbs()
    clearTimeout(flush)
  })

  let suggestions: Record<string, Suggestion> | undefined
  const stopSuggestions = backend.tagDecisions?.onSuggestions((s) => {
    suggestions = s.items
    setLib(withSuggestions(lib(), s.items))
    // 選択済みの候補がないものは、分類の確認に残す
    if (s.apply)
      for (const it of lib().pending()) {
        const tags = it.suggestion?.tags ?? []
        const chosen = tags.filter((t) => t.on).map((t) => t.tag)
        if (chosen.length)
          approveTags(it.id, {
            tags: chosen,
            rejected: tags.filter((t) => !t.on).map((t) => t.tag),
            project: it.project,
          })
      }
  })
  onCleanup(() => stopSuggestions?.())

  const stopChanged =
    backend.onChanged?.((c) => {
      const s = c.state
      const open = new Set(
        tabs().flatMap((t) => {
          const v = t.stack().at(-1)
          return v?.s === 'note' ? [v.id] : []
        }),
      )
      const rewritten = c.items.filter((it) => open.has(it.id) && it.body !== lib().byId.get(it.id)?.body)
      setLib(withChanged(lib(), c.items, c.removed, c.projects, c.tagCovers, s?.pins, c.groups))
      for (const it of rewritten) notify(`「${it.name}」が外部で変更されたため再読み込みしました`, 'info')
      if (c.removed.length) forget(c.removed)
      if (s?.pinnedProjects) setPinnedProjects(s.pinnedProjects)
      if (s?.pinnedTags) setPinnedTags(s.pinnedTags)
      if (c.orphans) {
        setOrphans(c.orphans)
        setOrphansHeld(false)
      }
      if (c.problems.length) {
        console.warn('読めなかったもの', c.problems)
        notify(`${c.problems.length} 件を読み込めませんでした`, 'error')
      }
    }) ?? (() => {})
  onCleanup(stopChanged)

  const [drag, setDrag] = createSignal<Dropped>()
  const dropPlace = (): ItemPlace => {
    const v = view()
    if (v.s === 'project') return { project: v.name, group: null }
    const g = v.s === 'group' ? lib().groupBy.get(v.id) : undefined
    return g ? { project: g.project, group: g.id } : ROOT
  }
  const [importing, setImporting] = createSignal(0)
  const importDropped = async (place = dropPlace()) => {
    if (!backend.importDropped) return []
    setImporting(importing() + 1)
    try {
      const r = await backend.importDropped(place)
      if (r.failed.length) console.warn('取り込めなかったもの', r.failed)
      setLib(withAdded(lib(), r.items, [], r.groups))
      notify(importedNotice(r), r.failed.length ? 'error' : r.items.length ? 'success' : 'info')
      return r.items
    } catch (e) {
      notify(`取り込みに失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error')
      return []
    } finally {
      setImporting(importing() - 1)
    }
  }
  const importFiles = async (files: File[], place: ItemPlace) => {
    const take = backend.importData
    if (!take) return []
    setImporting(importing() + 1)
    try {
      const done = await Promise.allSettled(files.map((f) => take(f, place)))
      const items = done.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const failed = done.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      if (failed.length) console.warn('取り込めなかったもの', failed)
      setLib(withAdded(lib(), items))
      if (failed.length) notify(`${failed.length} 件の取り込みに失敗しました`, 'error')
      return items
    } finally {
      setImporting(importing() - 1)
    }
  }

  const intoNote = () => {
    const v = view()
    const editor = editors.get(currentTab().id)
    return v.s === 'note' && editor && !peek() ? { editor, place: placeOf(lib().byId.get(v.id) ?? ROOT) } : undefined
  }
  const stopDrag =
    backend.onFileDrag?.((e) => {
      const into = intoNote()
      if (e.type === 'enter') setDrag(e.dropped)
      else if (e.type === 'over') into?.editor.dropAt(e)
      else if (e.type === 'drop') {
        setDrag(undefined)
        into?.editor.dropAt(undefined)
        if (!e.dropped.files) return
        const at = { x: e.x, y: e.y }
        if (into) void importDropped(into.place).then((items) => into.editor.insertItems(items, at))
        else void importDropped()
      } else if (e.type === 'leave') {
        setDrag(undefined)
        into?.editor.dropAt(undefined)
      }
    }) ?? (() => {})
  onCleanup(stopDrag)
  const making = progress()
  const waves = progress()
  const hooking = progress()
  const stopHookFailed =
    backend.onHookFailed?.((f) =>
      notify(`プラグイン「${f.plugin}」が「${f.item}」を処理できませんでした：${f.message}`, 'error'),
    ) ?? (() => {})
  onCleanup(stopHookFailed)
  const seenThumbs = backend.seenThumbs && watchSeen((ids) => backend.seenThumbs?.(ids))
  const [checking, setChecking] = createSignal(false)
  if (backend.pluginWork || backend.checking) {
    const poll = window.setInterval(() => {
      void backend.pluginWork?.().then((w) => {
        making.update(w.thumbnails)
        waves.update(w.waveforms)
        hooking.update(w.hooks)
      })
      void backend.checking?.().then(setChecking)
    }, 1000)
    onCleanup(() => clearInterval(poll))
  }
  const working = (key: string, icon: IconName, label: string, p: Progress, part: 'thumbnail' | 'waveform' | 'hook') =>
    p.ids().size
      ? [{ key, icon, label, done: p.done(), total: p.total(), onStop: () => void backend.stopPluginWork?.(part) }]
      : []
  const activities = (): Activity[] => [
    ...(checking() ? [{ key: 'check', icon: 'sync' as const, label: 'ライブラリの整合性を確認中' }] : []),
    ...working('thumbs', 'image', 'サムネイルを作成中', making, 'thumbnail'),
    ...working('waves', 'audio', '音声を解析中', waves, 'waveform'),
    ...working('hooks', 'plugin', 'プラグインで処理中', hooking, 'hook'),
    ...(importing() ? [{ key: 'import', icon: 'import' as const, label: 'ファイルを取り込み中' }] : []),
  ]
  const flatSub = () => {
    const f = lib().placeName(dropPlace())
    return f ? `ドロップして「${f}」に追加します` : 'ドロップして所属なしで取り込みます'
  }
  return {
    suggestions: () => suggestions,
    drag,
    importFiles,
    making,
    waves,
    seenThumbs,
    activities,
    flatSub,
    intoNote,
  }
}
