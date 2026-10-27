import { For, Match, Show, Switch, createEffect, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Chip } from '../../components/controls/Chip/Chip'
import { FloatingCard } from '../../components/overlay/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { LinkNone, LinkRow } from '../../components/nav/LinkRow/LinkRow'
import { AudioPlayer } from '../../components/media/AudioPlayer/AudioPlayer'
import { ImageZoom } from '../../components/media/ImageZoom/ImageZoom'
import { MediaView } from '../../components/media/MediaView/MediaView'
import { PluginView } from '../../components/media/PluginView/PluginView'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { TopBar } from '../../components/overlay/TopBar/TopBar'
import { type Blocker, Unsupported } from '../../components/media/Unsupported/Unsupported'
import { VideoPlayer } from '../../components/media/VideoPlayer/VideoPlayer'
import { type Library, relDay, thumbOf } from '../../model/library'
import type { ItemView, Part } from '../../plugins/types'
import type { UiApi, UiItem } from '../../plugins/ui'
import shared from '../screen.module.css'
import styles from './AssetScreen.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface AssetViewHost {
  view: (id: string) => Promise<ItemView | null>
  ui?: (item: UiItem, part: Part, plugin: string) => UiApi
  waveform?: (id: string) => Promise<Uint8Array | null>
}

export interface AssetScreenProps {
  lib: Library
  list: string[]
  index?: number
  infoOpen?: boolean
  idle?: boolean
  onOpenNote?: (id: string) => void
  onTogglePin?: (id: string) => void
  onProject?: (id: string, folder: string | null) => void
  onTag?: (id: string, tag: string, on: boolean) => void
  onMemo?: (id: string, memo: string) => void
  host?: AssetViewHost
  onIndex?: (i: number) => void
  blocker?: (ext: string) => Promise<Blocker | undefined>
  onEnablePlugin?: (p: Blocker) => Promise<void>
  onOpenPlugins?: (p?: Blocker) => void
  onReveal?: (id: string) => Promise<void>
  onOpenDefault?: (id: string) => Promise<void>
}

/** 書いている間は、保存した値で書き換えない。手が止まったとき、離れたとき、閉じたときに onChange を呼ぶ。 */
function MemoField(props: { value: string; onChange: (memo: string) => void }) {
  let el!: HTMLTextAreaElement
  let timer = 0
  let saved = props.value
  const flush = () => {
    clearTimeout(timer)
    if (el.value === saved) return
    saved = el.value
    props.onChange(saved)
  }
  createEffect(() => {
    const v = props.value
    if (document.activeElement === el) return
    el.value = saved = v
  })
  onCleanup(flush)
  return (
    <textarea
      ref={el}
      placeholder="メモ"
      onInput={() => {
        clearTimeout(timer)
        timer = window.setTimeout(flush, 500)
      }}
      onBlur={flush}
    />
  )
}

export function AssetScreen(props: AssetScreenProps) {
  const lib = () => props.lib
  const [i, setI] = createSignal(props.index ?? 0)
  const [info, setInfo] = createSignal(!!props.infoOpen)
  const it = () => lib().byId.get(props.list[i()] ?? '')
  const step = (d: number) => setI((i() + d + props.list.length) % props.list.length)
  createEffect(() => props.onIndex?.(i()))
  const unsupported = () => {
    const a = it()
    return !!a && !a.note && !lib().formats.has(a.ext)
  }
  const [blocker] = createResource(
    () => (unsupported() && props.blocker ? it()?.ext : undefined),
    async (ext) => (await props.blocker?.(ext).catch(() => undefined)) ?? null,
  )
  const [view] = createResource(
    () => (props.host && !unsupported() ? it()?.id : undefined),
    async (id) => (await props.host?.view(id).catch(() => null)) ?? null,
  )
  // 波形はサムネイルと一緒にできるので、サムネイルが変わったら読み直す
  const [wave] = createResource(
    () => {
      const a = it()
      return props.host?.waveform && a ? { id: a.id, thumb: a.thumb } : undefined
    },
    async ({ id }) => (await props.host?.waveform?.(id).catch(() => null)) ?? null,
  )
  /** いまの素材について決まったもの。決まるまでは、前の素材のものもサムネイルも出さない。 */
  const settled = () => !props.host || view.state === 'ready'
  const current = () => (view.state === 'ready' ? view() : undefined)
  const media = () => {
    const v = current()
    const src = (v?.kind === 'image' && v.url) || it()?.src
    return v && v.kind !== 'ui' && src ? { kind: v.kind, src } : undefined
  }
  const ui = () => {
    const v = current()
    const a = it()
    const make = props.host?.ui
    if (v?.kind !== 'ui' || !a || !make) return undefined
    return { url: v.url, api: make({ id: a.id, name: a.name, ext: a.ext, url: a.src }, 'view', v.plugin) }
  }
  const onKey = (e: KeyboardEvent) => {
    // Shift ＋ ← → は、再生の操作の帯が受け持つ
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [role="dialog"], [role="menu"]'))
      return
    if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'ArrowRight') step(1)
    else if (e.key.toLowerCase() === 'i') setInfo(!info())
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))
  const addTag = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    const a = it()
    if (e.key !== 'Enter' || e.isComposing || !a) return
    const tag = e.currentTarget.value.trim().replace(/^#\s*/, '')
    e.currentTarget.value = ''
    if (tag && !a.tags.includes(tag)) props.onTag?.(a.id, tag, true)
  }
  return (
    <section class={`${shared.screen} ${styles.root}`} data-idle={!!props.idle} aria-label="素材">
      <Show when={it()}>
        {(a) => (
          <>
            <div class={styles.stage}>
              <Switch
                fallback={
                  <Show when={settled()}>
                    <Thumb {...thumbOf(a(), 'L')} class={styles.box} />
                  </Show>
                }
              >
                <Match when={unsupported()}>
                  <Show when={!blocker.loading}>
                    <Unsupported
                      name={a().name}
                      ext={a().ext}
                      label={lib().formatLabel(a())}
                      blocker={blocker() ?? undefined}
                      onEnable={props.onEnablePlugin}
                      onOpenPlugins={props.onOpenPlugins}
                      onReveal={props.onReveal && (() => props.onReveal!(a().id))}
                      onOpenDefault={props.onOpenDefault && (() => props.onOpenDefault!(a().id))}
                    />
                  </Show>
                </Match>
                <Match when={ui()} keyed>
                  {(u) => <PluginView url={u.url} api={u.api} class={styles.page} />}
                </Match>
                <Match when={media()?.kind === 'image' && media()}>
                  {(m) => <ImageZoom src={m().src} name={a().name} class={styles.player} />}
                </Match>
                <Match when={media()?.kind === 'video' && media()}>
                  {(m) => <VideoPlayer src={m().src} poster={a().thumb} name={a().name} class={styles.player} />}
                </Match>
                <Match when={media()?.kind === 'audio' && media()}>
                  {(m) => (
                    <AudioPlayer
                      src={m().src}
                      wave={wave.state === 'ready' ? wave() : null}
                      name={a().name}
                      class={styles.player}
                    />
                  )}
                </Match>
                <Match when={media()}>
                  {(m) => (
                    <MediaView kind={m().kind} src={m().src} thumb={a().thumb} name={a().name} class={styles.view} />
                  )}
                </Match>
              </Switch>
            </div>
            <TopBar
              class={styles.bar}
              actions={
                <PinToggle
                  look="float"
                  pressed={lib().pins.includes(a().id)}
                  onClick={() => props.onTogglePin?.(a().id)}
                />
              }
            >
              <b>{a().name}</b>
              <span class={styles.meta}>
                {a().folder ?? 'プロジェクトなし'}
                {props.list.length > 1 && ` · ${i() + 1} / ${props.list.length}`}
              </span>
            </TopBar>
            <Show
              when={info()}
              fallback={
                <FloatingPill class={styles.pill} kbd="I" aria-expanded={false} onClick={() => setInfo(true)}>
                  <Icon name="info" size={14} />
                  情報
                </FloatingPill>
              }
            >
              <aside class={styles.info} aria-label="情報">
                <ScrollArea viewClass={styles.infoView}>
                  <FloatingCard title="情報" onClose={() => setInfo(false)}>
                    <label class={styles.fl}>
                      <span class={styles.k}>プロジェクト</span>
                      <select
                        value={a().folder ?? ''}
                        onChange={(e) => props.onProject?.(a().id, e.currentTarget.value || null)}
                      >
                        <option value="">プロジェクトなし</option>
                        <For each={lib().projects}>{(p) => <option value={p.name}>{p.name}</option>}</For>
                      </select>
                    </label>
                    <div class={styles.fl}>
                      <span class={styles.k}>タグ</span>
                      <div class={styles.tags}>
                        <For each={a().tags}>
                          {(t) => (
                            <Chip aria-label={`# ${t} を削除`} onClick={() => props.onTag?.(a().id, t, false)}>
                              # {t}
                              <Icon name="close" size={12} />
                            </Chip>
                          )}
                        </For>
                        <input type="text" placeholder="＋ タグ" aria-label="タグを追加" onKeyDown={addTag} />
                      </div>
                    </div>
                    <label class={styles.fl}>
                      <span class={styles.k}>メモ</span>
                      <Show when={a().id} keyed>
                        {(id) => <MemoField value={a().memo} onChange={(memo) => props.onMemo?.(id, memo)} />}
                      </Show>
                    </label>
                    <div class={styles.fl}>
                      <span class={styles.k}>この素材へのリンク {lib().backOf(a()).length}</span>
                      <Show when={lib().backOf(a()).length} fallback={<LinkNone>まだありません</LinkNone>}>
                        <For each={lib().backOf(a())}>
                          {(n) => <LinkRow mark="←" label={n.name} onClick={() => props.onOpenNote?.(n.id)} />}
                        </For>
                      </Show>
                    </div>
                    <details>
                      <summary class={styles.sum}>ファイルの詳細</summary>
                      <div class={styles.fi}>
                        <span>種類</span>
                        <span>
                          {lib().formatLabel(a())} · {a().ext}
                        </span>
                        <span>場所</span>
                        <span>
                          {a().folder ? `${a().folder}/` : ''}
                          {a().name}.{a().ext}
                        </span>
                        <span>メタ情報</span>
                        <span>
                          {a().name}.{a().ext}.meta
                        </span>
                        <span>更新日</span>
                        <span>{relDay(lib(), a().moved)}</span>
                      </div>
                    </details>
                  </FloatingCard>
                </ScrollArea>
              </aside>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
