import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, untrack } from 'solid-js'
import { messageOf } from '../../app/notice'
import { Spinner } from '../../components/base/Spinner/Spinner'
import { Button } from '../../components/controls/Button/Button'
import { ThumbMakingProvider } from '../../components/media/Thumb/Thumb'
import type { ArchiveActions, ArchiveThumb } from '../../backend/types'
import {
  type ArchiveFolder,
  type EntryItem,
  archiveTree,
  entryId,
  filesUnder,
  sameThumb,
  withThumb,
} from '../../model/archive'
import { type Group, type Library, thumbOf } from '../../model/library'
import { bytes } from '../Asset/AssetScreen'
import { DetailScreen } from '../Detail/DetailScreen'

export interface ArchiveScreenProps {
  lib: Library
  id: string
  name: string
  /** 表示するフォルダ。空ならアーカイブの直下 */
  path: string
  actions?: ArchiveActions
  onOpenFolder?: (path: string) => void
  onOpenEntries?: (items: EntryItem[], index: number) => void
  /** アーカイブの中のアーカイブを取り出したとき。 */
  onOpenArchive?: (id: string, name: string) => void
  onInfo?: () => void
  onError?: (message: string) => void
}

const FACES = 3

export function ArchiveScreen(props: ArchiveScreenProps) {
  const leaving = new AbortController()
  onCleanup(() => leaving.abort())
  const [entries] = createResource(async () => (await props.actions?.entries(props.id, leaving.signal)) ?? [])
  // lib は項目が変わるたびに作り直される。形式はそのたびに読み直さない
  const formats = () => untrack(() => props.lib.formats)
  const tree = createMemo(() => (entries.state === 'ready' ? archiveTree(props.id, entries(), formats()) : undefined))
  const here = () => tree()?.folders.get(props.path)
  const [flat, setFlat] = createSignal(false)

  // サムネイルが届いた項目だけを作り直し、ほかのカードは描き直さない
  const thumbed = new Map<string, EntryItem>()
  /** サムネイルの結果（生成できなかったことも含む）が届いた項目 */
  const answered = new Set<string>()
  const [version, setVersion] = createSignal(0)
  const latest = (it: EntryItem) => thumbed.get(it.id) ?? it
  const waiting: ArchiveThumb[] = []
  let timer = 0
  const flush = () => {
    timer = 0
    for (const t of waiting.splice(0)) {
      const id = entryId(props.id, t.path)
      const it = thumbed.get(id) ?? tree()?.files.get(id)
      if (it && !sameThumb(it, t)) thumbed.set(id, withThumb(it, t))
      answered.add(id)
    }
    setVersion((v) => v + 1)
  }
  onCleanup(() => clearTimeout(timer))
  const onThumb = (t: ArchiveThumb) => {
    waiting.push(t)
    timer ||= window.setTimeout(flush, 100)
  }

  // 表紙は目次だけで決まるので、サムネイルが届くたびに全ファイルをたどらない
  const faces = new WeakMap<ArchiveFolder, EntryItem[]>()
  const facesOf = (f: ArchiveFolder) => {
    const known = faces.get(f)
    if (known) return known
    const all = filesUnder(f)
    const thumbs = all.filter((it) => formats().get(it.ext)?.thumbnail)
    const picked = (thumbs.length ? thumbs : all).slice(0, FACES)
    faces.set(f, picked)
    return picked
  }
  const wanted = createMemo(() => {
    const d = here()
    if (!d) return []
    return flat() ? filesUnder(d) : [...d.files, ...d.folders.flatMap(facesOf)]
  })
  const [thumbing, setThumbing] = createSignal(false)
  createEffect(() => {
    const paths = wanted().map((it) => it.path)
    if (!paths.length || !props.actions) return
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    setThumbing(true)
    props.actions
      .thumbs(props.id, paths, onThumb, stop.signal)
      .catch((e: unknown) => {
        if (!stop.signal.aborted) console.warn(`サムネイルを生成できない: ${props.name}`, e)
      })
      .finally(() => {
        if (!stop.signal.aborted) setThumbing(false)
      })
  })
  const making = (id: string) => {
    version()
    if (!thumbing() || answered.has(id)) return false
    const it = tree()?.files.get(id)
    const f = it && !it.encrypted ? formats().get(it.ext) : undefined
    return !!f && ((f.thumbnail && !f.link) || f.media === 'audio')
  }

  const items = createMemo(() => {
    version()
    const d = here()
    return d ? (flat() ? filesUnder(d) : d.files).map(latest) : []
  })
  const folders = () => (flat() ? [] : (here()?.folders ?? []))
  const groupInfo = (g: Group) => {
    version()
    const f = tree()?.folders.get(g.id)
    return {
      count: f?.count ?? 0,
      faces: f ? facesOf(f).map((it) => ({ ...thumbOf(latest(it), 'S'), id: undefined })) : [],
    }
  }

  const isArchive = (it: EntryItem) => !!formats().get(it.ext)?.archive
  const [opening, setOpening] = createSignal(false)
  const openNested = async (it: EntryItem) => {
    if (!props.actions || opening()) return
    setOpening(true)
    try {
      const r = await props.actions.extract(props.id, it.path, leaving.signal)
      props.onOpenArchive?.(r.id, it.name)
    } catch (e) {
      if (!leaving.signal.aborted) props.onError?.(`ファイルの取り出しに失敗しました：${messageOf(e)}`)
    } finally {
      setOpening(false)
    }
  }
  const open = (id: string, list: string[]) => {
    const it = tree()?.files.get(id)
    if (!it) return
    if (it.encrypted) props.onError?.('パスワード付きのファイルは開けません')
    else if (isArchive(it)) void openNested(it)
    else {
      const shown = list.flatMap((x) => {
        const y = tree()?.files.get(x)
        return y && !y.encrypted && !isArchive(y) ? [latest(y)] : []
      })
      props.onOpenEntries?.(
        shown,
        shown.findIndex((x) => x.id === id),
      )
    }
  }

  const empty = () => {
    if (entries.loading) return <Spinner size={24} />
    if (entries.error) return `内容の読み込みに失敗しました：${messageOf(entries.error)}`
    return '項目がありません'
  }
  const title = () => props.path.slice(props.path.lastIndexOf('/') + 1) || props.name
  const meta = () => {
    if (opening()) return 'ファイルを取り出しています'
    const d = here()
    return d ? `${d.count} 件 | ${bytes(d.size)}` : ''
  }
  return (
    <ThumbMakingProvider value={making}>
      <DetailScreen
        label="アーカイブ"
        title={<h1>{title()}</h1>}
        meta={meta()}
        actions={
          <Show when={props.onInfo}>
            <Button size="sm" variant="ghost" onClick={() => props.onInfo?.()}>
              情報
            </Button>
          </Show>
        }
        items={items()}
        groups={folders()}
        groupInfo={groupInfo}
        plain
        flat={flat()}
        onFlat={here()?.folders.length ? setFlat : undefined}
        onOpenGroup={props.onOpenFolder}
        onOpenItem={open}
        empty={empty()}
      />
    </ThumbMakingProvider>
  )
}
