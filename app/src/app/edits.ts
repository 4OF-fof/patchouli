import { type Accessor, createEffect, createSignal, onMount } from 'solid-js'
import type { NewNote } from '../../plugins/sdk'
import type { Backend, ItemPatch, Orphan } from '../backend'
import type { Selection } from '../components/media/Selection/Selection'
import type { ToastLevel } from '../components/overlay/Toast/Toast'
import {
  type CoverPart,
  type Item,
  type Library,
  type Place as ItemPlace,
  ROOT,
  type TagCoverPart,
  newNoteName,
  newProjectName,
  placeOf,
  retag,
  samePlace,
  tagClash,
  tagsUsed,
  toggled,
  withChanged,
  withItem,
  withProject,
  withProjectCover,
  withRenamedProject,
  withRenamedTag,
  withTagCover,
  withToggledPin,
  withoutProject,
} from '../model/library'
import type { TidyDecision } from '../screens/Tidy/TidyScreen'
import { messageOf, namesOf } from './notice'
import type { View } from './view'

export interface EditsDeps {
  backend: Backend
  lib: Accessor<Library>
  setLib: (l: Library) => void
  pinnedProjects: Accessor<string[]>
  setPinnedProjects: (n: string[]) => void
  pinnedTags: Accessor<string[]>
  setPinnedTags: (t: string[]) => void
  saveState: () => void
  selection: Selection
  eachStack: (f: (s: View[]) => View[]) => void
  go: (v: View) => void
  forget: (ids: string[]) => void
  orphans?: Orphan[]
  persist: (job: () => Promise<void>) => void
  notify: (message: string, level: ToastLevel) => void
  fail: (e: unknown) => void
  failLoad: (e: unknown) => void
}

/** 項目・タグ・プロジェクトを変える操作。先に画面を変え、書けなかったら元に戻す。 */
export function createEdits(d: EditsDeps) {
  const { backend, lib, setLib, pinnedProjects, setPinnedProjects, pinnedTags, setPinnedTags, saveState } = d
  const { selection, eachStack, go, forget, persist, notify, fail, failLoad } = d
  // 文章が外で変わっていて書かなかったときは、読み直したものに替える。書けなかったときは元に戻す
  const editItem = (id: string, change: Partial<Item>, patch: ItemPatch) => {
    const it = lib().byId.get(id)
    if (!it) return
    const undo: Partial<Item> = Object.fromEntries(Object.entries(it).filter(([k]) => k in change))
    changeFile(id, change, undo, async () => {
      const read = await backend.saveItem(id, patch)
      if (read) notify('外部で変更されたため再読み込みしました', 'info')
      return read
    })
  }
  const [recentTags, setRecentTags] = createSignal<string[]>([])
  onMount(() => void backend.tagHistory?.().then(setRecentTags, failLoad))

  const tagItem = (id: string, tag: string, on: boolean) => {
    const tags = lib().byId.get(id)?.tags ?? []
    if (on) {
      const next = [tag, ...recentTags().filter((t) => t !== tag)].slice(0, 8)
      setRecentTags(next)
      persist(async () => backend.saveTagHistory?.(next))
    }
    editItem(
      id,
      { tags: on ? [...tags, tag] : tags.filter((t) => t !== tag) },
      { tags: on ? { add: [tag] } : { remove: [tag] } },
    )
  }
  const setAliases = (id: string, aliases: string[]) => {
    const old = lib().byId.get(id)?.aliases ?? []
    editItem(
      id,
      { aliases },
      { aliases: { add: aliases.filter((a) => !old.includes(a)), remove: old.filter((a) => !aliases.includes(a)) } },
    )
  }
  // 先に画面を変えておき、ファイルを変えられなかったら元に戻す
  const changeFile = (id: string, change: Partial<Item>, undo: Partial<Item>, run: () => Promise<Item | undefined>) => {
    const put = (c: Partial<Item>) => {
      const now = lib().byId.get(id)
      if (now) setLib(withChanged(lib(), [{ ...now, ...c }], []))
    }
    put(change)
    persist(async () => {
      try {
        const done = await run()
        if (done) setLib(withChanged(lib(), [done], []))
      } catch (e) {
        put(undo)
        throw e
      }
    })
  }
  const moveItem = (id: string, to: ItemPlace) => {
    const it = lib().byId.get(id)
    if (it && !samePlace(it, to)) changeFile(id, { ...to }, placeOf(it), () => backend.moveItem(id, to))
  }
  // 1 件ずつ動かし、動かせなかったものは元に戻して名前を知らせる
  const moveItems = (ids: string[], to: ItemPlace) => {
    const its = ids.flatMap((id) => lib().byId.get(id) ?? []).filter((it) => !samePlace(it, to))
    if (its.length <= 1) {
      if (its[0]) moveItem(its[0].id, to)
      return
    }
    setLib(
      withChanged(
        lib(),
        its.map((it) => ({ ...it, ...to })),
        [],
      ),
    )
    selection.clear()
    persist(async () => {
      const failed: Item[] = []
      for (const it of its) {
        try {
          const done = await backend.moveItem(it.id, to)
          if (done) setLib(withChanged(lib(), [done], []))
        } catch {
          const now = lib().byId.get(it.id)
          if (now) setLib(withChanged(lib(), [{ ...now, ...placeOf(it) }], []))
          failed.push(it)
        }
      }
      const place = `「${lib().placeName(to) ?? '所属なし'}」へ`
      const moved = its.length - failed.length
      if (failed.length)
        notify(
          `${moved ? `${moved} 件を${place}移動しました。` : ''}${namesOf(failed)}は、同じ名前のファイルが存在するため移動できませんでした`,
          'error',
        )
      else notify(`${moved} 件を${place}移動しました`, 'success')
    })
  }
  const approveTags = (id: string, decision: TidyDecision) => {
    const it = lib().byId.get(id)
    if (!it) return
    const add = decision.tags.filter((t) => !it.tags.includes(t))
    if (add.length) editItem(id, { tags: [...it.tags, ...add] }, { tags: { add } })
    if (decision.project !== it.project) moveItem(id, { project: decision.project, group: null })
    const decisions = backend.tagDecisions
    if (decisions) persist(() => decisions.record(id, decision.tags, decision.rejected))
  }
  const undoTags = (before: Item) => {
    const it = lib().byId.get(before.id)
    if (!it) return
    const remove = it.tags.filter((t) => !before.tags.includes(t))
    if (remove.length) editItem(it.id, { tags: before.tags }, { tags: { remove } })
    moveItem(it.id, placeOf(before))
    const decisions = backend.tagDecisions
    if (decisions) persist(() => decisions.undo(it.id))
  }
  const tagItems = (ids: string[], tag: string, on: boolean) => {
    for (const id of ids) if (lib().byId.get(id)?.tags.includes(tag) !== on) tagItem(id, tag, on)
  }
  const renameItem = (id: string, name: string) => {
    const it = lib().byId.get(id)
    if (it && it.name !== name) changeFile(id, { name }, { name: it.name }, () => backend.renameItem(id, name))
  }

  const deleteItems = (ids: string[]) => {
    const del = backend.deleteItem
    const its = ids.flatMap((id) => lib().byId.get(id) ?? [])
    if (!del || !its.length) return
    persist(async () => {
      const failed: { it: Item; e: unknown }[] = []
      let pinned = false
      for (const it of its) {
        try {
          await del(it.id)
        } catch (e) {
          failed.push({ it, e })
          continue
        }
        pinned ||= lib().pins.includes(it.id)
        setLib(withChanged(lib(), [], [it.id]))
        forget([it.id])
      }
      if (pinned) saveState()
      const done = its.length - failed.length
      const one = its.length === 1 ? its[0] : undefined
      if (one && failed[0]) notify(`削除に失敗しました：${messageOf(failed[0].e)}`, 'error')
      else if (one) notify(`「${one.name}」をごみ箱に移動しました`, 'success')
      else if (failed.length)
        notify(
          `${done ? `${done} 件をごみ箱に移動しました。` : ''}${namesOf(failed.map((f) => f.it))}は削除できませんでした`,
          'error',
        )
      else notify(`${done} 件をごみ箱に移動しました`, 'success')
    })
  }
  const [deleting, setDeleting] = createSignal<string[]>()

  const allTags = () => [...lib().tagGroups().keys()].toSorted((x, y) => x.localeCompare(y, 'ja'))

  const createProject = async () => {
    const name = newProjectName(lib())
    try {
      setLib(withProject(lib(), await backend.createProject(name)))
      go({ s: 'project', name, editing: true })
    } catch (e) {
      fail(e)
    }
  }
  const addNote = async (name: string | undefined, place: ItemPlace) => {
    try {
      const it = await backend.createNote(newNoteName(lib(), name), place)
      setLib(withItem(lib(), it))
      return it
    } catch (e) {
      fail(e)
      return undefined
    }
  }
  const createNote = async (name?: string) => {
    const it = await addNote(name, ROOT)
    if (it) go({ s: 'note', id: it.id })
  }
  const addNoteWith = async (n: NewNote) => {
    const it = await addNote(n.name, { project: n.project ?? null, group: null })
    if (it && n.body) editItem(it.id, { body: n.body }, { body: n.body })
    return it
  }
  const setTags = (id: string, tags: string[]) => {
    const old = lib().byId.get(id)?.tags ?? []
    const add = tags.filter((t) => !old.includes(t))
    const remove = old.filter((t) => !tags.includes(t))
    if (add.length || remove.length) editItem(id, { tags }, { tags: { add, remove } })
  }

  const renameTag = (from: string, to: string, keepFrom = false) => {
    const re = retag(from, to)
    setLib(withRenamedTag(lib(), from, to, keepFrom))
    setPinnedTags([...new Set(pinnedTags().map(re))])
    eachStack((s) => s.map((v) => (v.s === 'tag' ? { ...v, tag: re(v.tag) } : v)))
    persist(() => backend.renameTag(from, to, keepFrom))
    saveState()
  }
  const [merging, setMerging] = createSignal<{ from: string; to: string }>()
  // すでにあるタグの名前に変えるときは、マージするか別の名前にするかを聞く
  const requestRenameTag = (from: string, to: string) => {
    if (tagClash(lib(), from, to).clash) {
      setMerging({ from, to })
    } else {
      setMerging(undefined)
      renameTag(from, to)
    }
  }
  const saveTagCover = (tag: string, cover: TagCoverPart[]) => {
    setLib(withTagCover(lib(), tag, cover))
    persist(() => backend.saveTagCover(tag, cover))
  }
  const deleteTagCover = (tag: string) => {
    setLib(withTagCover(lib(), tag))
    persist(() => backend.deleteTagCover(tag))
  }
  // 概要のあるタグが、どの項目にも付かなくなったら、概要を削除するか聞く
  const [goneTags, setGoneTags] = createSignal<string[]>([])
  const nextGoneTag = () => setGoneTags(goneTags().slice(1))
  let tagsBefore = lib()
  createEffect(() => {
    const now = lib()
    const before = tagsBefore
    tagsBefore = now
    const had = tagsUsed(before)
    const has = tagsUsed(now)
    const gone = [...now.tagCovers.keys()].filter((t) => !has.has(t) && had.has(t))
    if (gone.length) setGoneTags((g) => [...new Set([...g, ...gone])])
  })
  const saveProjectCover = (name: string, cover: CoverPart[]) => {
    setLib(withProjectCover(lib(), name, cover))
    persist(() => backend.saveProject(name, cover))
  }
  const renameProject = (from: string, to: string) => {
    const rename = backend.renameProject
    if (!rename) return
    if (lib().projectBy.has(to)) {
      notify(`プロジェクト「${to}」はすでに存在します`, 'error')
      return
    }
    persist(async () => {
      await rename(from, to)
      setLib(withRenamedProject(lib(), from, to))
      setPinnedProjects(pinnedProjects().map((n) => (n === from ? to : n)))
      eachStack((s) => s.map((v) => (v.s === 'project' && v.name === from ? { s: 'project', name: to } : v)))
      saveState()
    })
  }
  const deleteProject = (name: string) => {
    const del = backend.deleteProject
    if (!del) return
    persist(async () => {
      await del(name)
      setLib(withoutProject(lib(), name))
      setPinnedProjects(pinnedProjects().filter((n) => n !== name))
      eachStack((s) => {
        const rest = s.filter((v) => !(v.s === 'project' && v.name === name))
        return rest.length ? rest : [{ s: 'edition' }]
      })
      saveState()
      notify(`プロジェクト「${name}」を削除し、中の項目を所属なしに移動しました`, 'success')
    })
  }
  const [orphans, setOrphans] = createSignal(d.orphans ?? [])
  const [orphansHeld, setOrphansHeld] = createSignal(false)
  const settleOrphan = (meta: string, job?: () => Promise<void>) => {
    if (!job) return
    setOrphans(orphans().filter((o) => o.meta !== meta))
    persist(job)
  }

  const togglePin = (id: string) => {
    setLib(withToggledPin(lib(), id))
    saveState()
  }
  const pinItems = (ids: string[], on: boolean) => {
    let next = lib()
    for (const id of ids) if (next.pins.includes(id) !== on) next = withToggledPin(next, id)
    setLib(next)
    saveState()
  }
  const toggleProjectPin = (name: string) => {
    setPinnedProjects(toggled(pinnedProjects(), name))
    saveState()
  }
  const toggleTagPin = (tag: string) => {
    setPinnedTags(toggled(pinnedTags(), tag))
    saveState()
  }
  return {
    editItem,
    recentTags,
    tagItem,
    setAliases,
    moveItem,
    moveItems,
    approveTags,
    undoTags,
    tagItems,
    renameItem,
    deleteItems,
    deleting,
    setDeleting,
    allTags,
    createProject,
    addNote,
    createNote,
    addNoteWith,
    setTags,
    renameTag,
    merging,
    setMerging,
    requestRenameTag,
    saveTagCover,
    deleteTagCover,
    goneTags,
    nextGoneTag,
    saveProjectCover,
    renameProject,
    deleteProject,
    orphans,
    setOrphans,
    orphansHeld,
    setOrphansHeld,
    settleOrphan,
    togglePin,
    pinItems,
    toggleProjectPin,
    toggleTagPin,
  }
}
