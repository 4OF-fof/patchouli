import { createMemo, onCleanup } from 'solid-js'
import { messageOf } from '../../app/notice'
import type { ArchiveActions } from '../../backend/types'
import type { EntryItem } from '../../model/archive'
import { AssetScreen, type AssetScreenProps, type AssetViewHost } from '../Asset/AssetScreen'

export interface EntryScreenProps extends Pick<
  AssetScreenProps,
  'lib' | 'index' | 'infoOpen' | 'onIndex' | 'blocker' | 'onEnablePlugin' | 'onOpenPlugins'
> {
  items: EntryItem[]
  host?: AssetViewHost
  actions?: ArchiveActions
  onOpenDefault?: (id: string) => Promise<void>
  onError?: (message: string) => void
}

/** アーカイブの中のファイルを、開いたものから取り出して素材の画面で表示する。 */
export function EntryScreen(props: EntryScreenProps) {
  const byId = createMemo(() => new Map(props.items.map((it) => [it.id, it])))
  let running: { id: string; stop: AbortController; done: Promise<void> } | undefined
  onCleanup(() => running?.stop.abort())

  const extract = (id: string): Promise<void> => {
    const it = byId().get(id)
    if (!it || it.src || !props.actions) return Promise.resolve()
    if (running?.id === id) return running.done
    // 送っている途中のファイルは、取り出しを待たずに次へ移る
    running?.stop.abort()
    const stop = new AbortController()
    const done = props.actions.extract(it.archive, it.path, stop.signal).then(
      (r) => {
        it.src = r.url
      },
      (e: unknown) => {
        if (running?.id === id) running = undefined
        if (!stop.signal.aborted) props.onError?.(`ファイルの取り出しに失敗しました：${messageOf(e)}`)
        throw e
      },
    )
    running = { id, stop, done }
    return done
  }
  const after =
    <T,>(run: (id: string) => Promise<T>) =>
    async (id: string) => {
      await extract(id)
      return run(id)
    }
  const host = createMemo((): AssetViewHost | undefined => {
    const h = props.host
    return h && { ...h, view: after(h.view), details: h.details && after(h.details), waveform: undefined }
  })
  return (
    <AssetScreen
      lib={props.lib}
      list={props.items.map((it) => it.id)}
      index={props.index}
      infoOpen={props.infoOpen}
      onIndex={props.onIndex}
      entries={(id) => byId().get(id)}
      host={host()}
      blocker={props.blocker}
      onEnablePlugin={props.onEnablePlugin}
      onOpenPlugins={props.onOpenPlugins}
      onOpenDefault={props.onOpenDefault && ((id) => extract(id).then(() => props.onOpenDefault?.(id)))}
    />
  )
}
