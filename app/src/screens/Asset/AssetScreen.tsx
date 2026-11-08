import {
  For,
  type JSX,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Chip } from '../../components/controls/Chip/Chip'
import { IconButton } from '../../components/controls/IconButton/IconButton'
import { PlaceSelect } from '../../components/controls/PlaceSelect/PlaceSelect'
import { TagPicker } from '../../components/controls/TagPicker/TagPicker'
import { LinkNone, LinkRow } from '../../components/nav/LinkRow/LinkRow'
import { middleClick } from '../../components/nav/TabPane/newTab'
import { useTabActive } from '../../components/nav/TabPane/TabPane'
import { useBarTools } from '../AppBar'
import { AudioPlayer } from '../../components/media/AudioPlayer/AudioPlayer'
import { ImageZoom } from '../../components/media/ImageZoom/ImageZoom'
import { PluginView } from '../../components/media/PluginView/PluginView'
import { Thumb, menuBelow, useItemMenu } from '../../components/media/Thumb/Thumb'
import { type Blocker, Unsupported } from '../../components/media/Unsupported/Unsupported'
import { VideoPlayer } from '../../components/media/VideoPlayer/VideoPlayer'
import { type Item, type Library, type Place, SHORTCUT_EXT, jacketOf, relDay, thumbOf } from '../../model/library'
import { UrlField } from '../../components/controls/UrlField/UrlField'
import { onFlush } from '../../model/persist'
import { WebPage } from '../../components/media/WebPage/WebPage'
import type { BrowserActions, LinkShown } from '../../backend/types'
import type { ItemDetails, ItemView, Part } from '../../plugins/types'
import type { UiApi, UiItem } from '../../plugins/ui'
import { useTagPicker } from '../useTagPicker'
import shared from '../screen.module.css'
import styles from './AssetScreen.module.css'
import { coverPage } from '../../components/media/WebPage/layer'
import { Icon } from '../../components/base/Icon/Icon'
import { Spinner } from '../../components/base/Spinner/Spinner'

export interface AssetViewHost {
  view: (id: string) => Promise<ItemView | null>
  ui?: (item: UiItem, part: Part, plugin: string) => UiApi
  waveform?: (id: string) => Promise<Uint8Array | null>
  details?: (id: string) => Promise<ItemDetails>
  linkOf?: (url: string, part: Part) => LinkShown
  browser?: BrowserActions
  openUrl?: (url: string) => void
  /** 設定に合わせて、内蔵ブラウザか既定のアプリで開く。 */
  openLink?: (url: string) => void
}

export interface AssetScreenProps {
  lib: Library
  list: string[]
  index?: number
  /** 最初に開いた素材を、この秒から再生する */
  startAt?: number
  infoOpen?: boolean
  idle?: boolean
  onOpenNote?: (id: string) => void
  onOpenTag?: (tag: string) => void
  onTogglePin?: (id: string) => void
  onMove?: (id: string, place: Place) => void
  onRename?: (id: string, name: string) => void
  onTag?: (id: string, tag: string, on: boolean) => void
  onMemo?: (id: string, memo: string) => void
  onUrl?: (id: string, url: string) => void
  recentTags?: string[]
  /** タグを選び始めるたびに呼ぶ。付いていないタグも、まだないタグも返してよい */
  suggestTags?: (id: string) => Promise<string[]>
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
  onCleanup(onFlush(flush))
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

/** Enter か離れたときに onChange を呼ぶ。空にしたときと Esc では元に戻す。 */
function NameField(props: { value: string; class?: string; onChange: (name: string) => void }) {
  let el!: HTMLInputElement
  createEffect(() => {
    const v = props.value
    if (document.activeElement !== el) el.value = v
  })
  const commit = () => {
    const v = el.value.trim()
    if (v && v !== props.value) props.onChange(v)
    else el.value = props.value
  }
  return (
    <input
      ref={el}
      class={props.class}
      type="text"
      aria-label="名前"
      spellcheck={false}
      onKeyDown={(e) => {
        if (e.isComposing) return
        if (e.key === 'Enter') {
          commit()
          el.blur()
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          el.value = props.value
          el.blur()
        }
      }}
      onBlur={commit}
    />
  )
}

/** タグセレクタの高さを、少なくともこれだけは取る。 */
const MIN_PICKER = 280

/** 舞台に出すもの。同じ素材でも、これが変わったら読み直す。 */
type Look =
  | { id: string; kind: 'image' | 'video' | 'audio'; src: string }
  | { id: string; kind: 'ui'; src: string; item: UiItem; api: () => UiApi }
  | { id: string; kind: 'link'; src: string; shown?: LinkShown }

const sameLook = (x: Look | undefined, y: Look | undefined) =>
  x === y ||
  (!!x &&
    !!y &&
    x.id === y.id &&
    x.kind === y.kind &&
    x.src === y.src &&
    (x.kind !== 'ui' || (y.kind === 'ui' && x.item.name === y.item.name && x.item.url === y.item.url)))

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

function bytes(n: number) {
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${i === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${UNITS[i]}`
}

const revokeView = (v: ItemView | null | undefined) => {
  if (v?.kind === 'image' && v.url?.startsWith('blob:')) URL.revokeObjectURL(v.url)
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
  createEffect<ItemView | null | undefined>((prev) => {
    const v = view.latest
    if (prev !== v) revokeView(prev)
    return v
  })
  onCleanup(() => revokeView(view.latest))
  // 波形はサムネイルと一緒にできるので、サムネイルが変わったら読み直す
  const waveOf = createMemo(
    () => {
      const a = it()
      return props.host?.waveform && a ? { id: a.id, thumb: a.thumb } : undefined
    },
    undefined,
    { equals: (x, y) => x?.id === y?.id && x?.thumb === y?.thumb },
  )
  const [wave] = createResource(waveOf, async ({ id }) => (await props.host?.waveform?.(id).catch(() => null)) ?? null)
  const shownWave = createMemo<{ id: string; wave: Uint8Array | null } | undefined>((prev) => {
    const id = it()?.id
    if (!id) return undefined
    if (wave.loading && prev?.id === id) return prev
    return { id, wave: wave.state === 'ready' ? wave() : null }
  })
  /** いまの素材について決まったもの。決まるまでは、前の素材のものもサムネイルも出さない。 */
  const settled = () => !props.host || view.state === 'ready'
  const look = createMemo<Look | undefined>(
    () => {
      const v = view.state === 'ready' ? view() : undefined
      const a = it()
      if (!v || !a) return undefined
      if (v.kind === 'ui') {
        const make = props.host?.ui
        const item = { id: a.id, name: a.name, ext: a.ext, url: a.src }
        return make && { id: a.id, kind: 'ui', src: v.url, item, api: () => make(item, 'view', v.plugin) }
      }
      if (v.kind === 'link') return { id: a.id, kind: 'link', src: v.url, shown: props.host?.linkOf?.(v.url, 'view') }
      const src = (v.kind === 'image' && v.url) || a.src
      return src ? { id: a.id, kind: v.kind, src } : undefined
    },
    undefined,
    { equals: sameLook },
  )
  /** 先頭が出しているもの、2 つ目が裏で読んでいるもの。同じ素材のまま変わったときは、読めるまで前のものを出しておく。 */
  const [looks, setLooks] = createSignal<Look[]>([])
  createEffect(() => {
    const next = look()
    const [now] = untrack(looks)
    setLooks(!next ? [] : now?.id !== next.id || sameLook(now, next) ? [next] : [now, next])
  })
  const ready = (l: Look) => {
    if (looks()[1] === l) setLooks([l])
  }
  /** 外のページを出している間は、ページ送りとボタンをアドレスバーの行に置く。 */
  const webShown = () => {
    const l = looks()[0]
    return l?.kind === 'link' && !l.shown?.ui
  }
  const overlaySteps = () => props.list.length > 1 && (!webShown() || !!barTools())
  /** WebView のデコーダーで読めなかったものの src。 */
  const [broken, setBroken] = createSignal<string>()
  const undecoded = () => {
    const l = looks()[0]
    return !!l && l.kind !== 'ui' && broken() === l.src
  }
  const lookView = (l: Look, a: () => Item) => {
    const start = a().id === props.list[props.index ?? 0] ? props.startAt : undefined
    const onReady = () => ready(l)
    const onUnsupported = () => setBroken(l.src)
    if (l.kind === 'ui') return <PluginView url={l.src} api={l.api()} class={styles.page} onReady={onReady} />
    if (l.kind === 'link') {
      const ui = l.shown?.ui
      if (ui) return <PluginView url={ui.url} api={ui.api} link class={styles.page} onReady={onReady} />
      queueMicrotask(onReady)
      return (
        <WebPage
          url={l.src}
          browser={props.host?.browser}
          onOpenDefault={props.host?.openUrl}
          class={styles.page}
          barAt={barTools()}
          trail={<Show when={active() || !barTools()}>{tools(a, true)}</Show>}
          lead={
            <Show when={props.list.length > 1 && !barTools()}>
              <IconButton label="前の素材" data-tip="前の素材（←）" onClick={() => step(-1)}>
                <Icon name="back" size={14} />
              </IconButton>
              <IconButton label="次の素材" data-tip="次の素材（→）" onClick={() => step(1)}>
                <Icon name="chevron" size={14} />
              </IconButton>
              <span class={styles.pageCount}>
                {i() + 1} / {props.list.length}
              </span>
            </Show>
          }
        />
      )
    }
    if (l.kind === 'image')
      return (
        <ImageZoom
          src={l.src}
          name={a().name}
          class={styles.player}
          fullscreen={() => root}
          onReady={onReady}
          onUnsupported={onUnsupported}
        />
      )
    if (l.kind === 'video')
      return (
        <VideoPlayer
          src={l.src}
          poster={a().thumb}
          name={a().name}
          class={styles.player}
          start={start}
          fullscreen={() => root}
          onReady={onReady}
          onUnsupported={onUnsupported}
        />
      )
    return (
      <AudioPlayer
        src={l.src}
        wave={shownWave()?.wave ?? null}
        name={a().name}
        look="stage"
        jacket={jacketOf(a())}
        class={styles.audio}
        start={start}
        fullscreen={() => root}
        onReady={onReady}
        onUnsupported={onUnsupported}
      >
        <div class={styles.title}>
          <b>{a().name}</b>
          <span>{lib().placeName(a()) ?? '所属なし'}</span>
        </div>
      </AudioPlayer>
    )
  }
  const active = useTabActive()
  const onKey = (e: KeyboardEvent) => {
    // Shift ＋ ← → は、再生の操作の帯が受け持つ
    if (!active() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [role="dialog"], [role="menu"]'))
      return
    if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'ArrowRight') step(1)
    else if (e.key.toLowerCase() === 'i') setInfo(!info())
    else if (e.key === 'Escape' && info()) setInfo(false)
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))
  let root!: HTMLElement
  const [at, setAt] = createSignal<JSX.CSSProperties>({})
  /**
   * 押したボタンの左に、検索欄がボタンの横に来るように出す。下に入りきらないときは上へずらす。
   * 検索欄の位置は、出したあとに測って合わせる。
   */
  const place = () => {
    const input = root.querySelector<HTMLElement>('[role="dialog"] input')
    const addBtn = button()
    if (!addBtn || !input) return
    const s = root.getBoundingClientRect()
    const b = addBtn.getBoundingClientRect()
    const field = input.getBoundingClientRect()
    const dialog = input.closest('[role="dialog"]')?.getBoundingClientRect()
    const offset = dialog ? field.top + field.height / 2 - dialog.top : 0
    const want = b.top + b.height / 2 - s.top - offset
    const top = Math.max(52, Math.min(want, s.height - 18 - MIN_PICKER))
    setAt({
      '--picker-right': `${s.right - b.left + 8}px`,
      '--picker-top': `${top}px`,
      '--picker-max': `${s.height - top - 18}px`,
    })
  }
  const {
    picking,
    recent,
    toggle: togglePicker,
    close: closePicker,
    allTags,
    button,
    setButton,
  } = useTagPicker({ lib, recentTags: () => props.recentTags, reset: info, place })
  const [suggested] = createResource(
    () => (picking() ? it()?.id : undefined),
    async (id) => (await props.suggestTags?.(id).catch(() => [])) ?? [],
  )
  const [details] = createResource(
    () => (props.host?.details ? it()?.id : undefined),
    async (id) => (await props.host?.details?.(id).catch(() => null)) ?? null,
  )
  const [fileOpen, setFileOpen] = createSignal(false)
  /** 手が止まってしばらくしたら、上の帯や操作を隠す。操作の上にポインタがある間は隠さない */
  const [still, setStill] = createSignal(false)
  let stillTimer = 0
  const wake = (after = 2500) => {
    setStill(false)
    clearTimeout(stillTimer)
    stillTimer = window.setTimeout(() => {
      if (root.querySelector('button:hover, input:hover, [role="group"]:hover')) wake()
      else setStill(true)
    }, after)
  }
  onMount(() => wake())
  onCleanup(() => clearTimeout(stillTimer))
  const idle = () => !!props.idle || still()
  const barTools = useBarTools()
  const inBar = () => (active() ? barTools() : undefined)
  const itemMenu = useItemMenu()
  const tools = (a: () => Item, bar: boolean) => {
    let more!: HTMLButtonElement
    return (
      <>
        <button
          type="button"
          class={bar ? styles.barBtn : `${styles.btn} ${styles.pin} ${styles.fade}`}
          aria-pressed={lib().pins.includes(a().id)}
          aria-label={lib().pins.includes(a().id) ? 'ピン留めを解除' : 'ピン留め'}
          data-tip={lib().pins.includes(a().id) ? 'ピン留めを解除' : 'ピン留め'}
          onClick={() => props.onTogglePin?.(a().id)}
        >
          <Icon name="pin" size={15} class={styles.pinGlyph} />
        </button>
        <button
          type="button"
          class={bar ? styles.barBtn : `${styles.btn} ${styles.more} ${styles.fade}`}
          ref={more}
          aria-expanded={itemMenu?.anchor() === more}
          aria-label="その他"
          data-tip="その他"
          onClick={(e) => {
            setInfo(false)
            itemMenu?.open(a().id, menuBelow(e))
          }}
        >
          <Icon name="more" size={15} />
        </button>
        <button
          type="button"
          class={bar ? styles.barBtn : `${styles.btn} ${styles.infoBtn} ${styles.fade}`}
          aria-expanded={info()}
          aria-label={info() ? '情報を閉じる' : '情報'}
          data-tip={info() ? '情報を閉じる（I）' : '情報（I）'}
          onClick={() => setInfo(!info())}
        >
          <Icon name="info" size={15} />
        </button>
      </>
    )
  }
  return (
    <section
      ref={root}
      class={`${shared.screen} ${styles.root}`}
      data-idle={idle()}
      data-info={info()}
      data-bar={!!barTools() || undefined}
      data-steps={(overlaySteps() && !webShown()) || undefined}
      data-web={webShown() || undefined}
      aria-label="素材"
      onPointerMove={() => wake()}
      onPointerDown={() => wake()}
      onPointerLeave={() => wake(600)}
    >
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
                <Match when={undecoded()}>
                  <Unsupported
                    name={a().name}
                    ext={a().ext}
                    label={lib().formatLabel(a())}
                    decoder
                    onReveal={props.onReveal && (() => props.onReveal!(a().id))}
                    onOpenDefault={props.onOpenDefault && (() => props.onOpenDefault!(a().id))}
                  />
                </Match>
                <Match when={looks().length}>
                  <For each={looks()}>
                    {(l, n) => (
                      <div class={styles.look} data-next={n() > 0 || undefined}>
                        {lookView(l, a)}
                      </div>
                    )}
                  </For>
                  <Show when={looks().length > 1}>
                    <div class={styles.veil}>
                      <Spinner size={28} />
                    </div>
                  </Show>
                </Match>
              </Switch>
            </div>
            <Show when={overlaySteps()}>
              {/* カーソルが外のページの上にあると動きを受け取れないので、外のページでは隠さない */}
              <div class={`${styles.strip} ${webShown() ? '' : styles.fade}`}>
                <button
                  ref={coverPage}
                  type="button"
                  class={styles.btn}
                  aria-label="前の素材"
                  data-tip="前の素材（←）"
                  onClick={() => step(-1)}
                >
                  <Icon name="back" size={14} />
                </button>
                <button
                  ref={coverPage}
                  type="button"
                  class={styles.btn}
                  aria-label="次の素材"
                  data-tip="次の素材（→）"
                  onClick={() => step(1)}
                >
                  <Icon name="chevron" size={14} />
                </button>
                <span ref={coverPage} class={styles.count}>
                  {i() + 1} / {props.list.length}
                </span>
              </div>
            </Show>
            <Show when={!webShown() && inBar()} keyed fallback={!barTools() && !webShown() && tools(a, false)}>
              {(el) => (
                <Portal mount={el}>
                  <span class={styles.barTools}>{tools(a, true)}</span>
                </Portal>
              )}
            </Show>
            <Show when={info()}>
              <aside ref={coverPage} class={styles.info} aria-label="情報">
                <div class={styles.infoHead}>情報</div>
                <ScrollArea class={styles.infoScroll} viewClass={styles.infoView}>
                  <div class={styles.fl}>
                    <NameField
                      class={styles.name}
                      value={a().name}
                      onChange={(name) => props.onRename?.(a().id, name)}
                    />
                  </div>
                  <div class={styles.fl}>
                    <span class={styles.k}>所属</span>
                    <PlaceSelect
                      lib={lib()}
                      aria-label="所属"
                      value={a()}
                      onChange={(to) => props.onMove?.(a().id, to)}
                    />
                  </div>
                  <div class={styles.fl}>
                    <span class={styles.k}>タグ</span>
                    <div class={styles.tags}>
                      <For each={a().tags}>
                        {(t) => (
                          <Chip
                            removeLabel={`# ${t} を削除`}
                            onClick={() => props.onOpenTag?.(t)}
                            {...middleClick(() => props.onOpenTag?.(t))}
                            onRemove={() => props.onTag?.(a().id, t, false)}
                          >
                            # {t}
                          </Chip>
                        )}
                      </For>
                      <Chip
                        ref={setButton}
                        dashed
                        aria-expanded={picking()}
                        aria-haspopup="dialog"
                        onClick={togglePicker}
                      >
                        <Icon name="plus" size={12} withText />
                        追加
                      </Chip>
                    </div>
                  </div>
                  <label class={styles.fl}>
                    <span class={styles.k}>メモ</span>
                    <Show when={a().id} keyed>
                      {(id) => <MemoField value={a().memo} onChange={(memo) => props.onMemo?.(id, memo)} />}
                    </Show>
                  </label>
                  <div class={styles.fl}>
                    <span class={styles.k}>URL</span>
                    <UrlField
                      value={a().url}
                      required={a().ext === SHORTCUT_EXT}
                      onChange={(url) => props.onUrl?.(a().id, url)}
                      onOpen={props.host?.openLink}
                    />
                  </div>
                  <div class={styles.fl}>
                    <span class={styles.k}>この素材へのリンク {lib().backOf(a()).length}</span>
                    <Show when={lib().backOf(a()).length} fallback={<LinkNone>リンクはまだありません</LinkNone>}>
                      <For each={lib().backOf(a())}>
                        {(n) => <LinkRow mark="←" label={n.name} onClick={() => props.onOpenNote?.(n.id)} />}
                      </For>
                    </Show>
                  </div>
                  <details open={fileOpen()} onToggle={(e) => setFileOpen(e.currentTarget.open)}>
                    <summary class={styles.sum}>
                      <Icon name="chevron" size={12} class={styles.sumIcon} withText />
                      ファイルの詳細
                    </summary>
                    <div class={styles.fi}>
                      <span>種類</span>
                      <span>{a().ext}</span>
                      <Show when={details.loading}>
                        <span />
                        <Spinner size={12} />
                      </Show>
                      <For each={details.state === 'ready' ? details()?.rows : undefined}>
                        {(r) => (
                          <>
                            <span>{r.label}</span>
                            <span class={details()?.url ? styles.line : undefined} title={r.value}>
                              {r.value}
                            </span>
                          </>
                        )}
                      </For>
                      <Show when={details.state === 'ready' && details()}>
                        {(d) => (
                          <Show
                            when={d().url}
                            fallback={
                              <>
                                <span>サイズ</span>
                                <span>{bytes(d().size)}</span>
                              </>
                            }
                          >
                            {(url) => (
                              <>
                                <span>URL</span>
                                <button
                                  type="button"
                                  class={`${styles.line} ${styles.url}`}
                                  title={url()}
                                  onClick={() => props.host?.openLink?.(url())}
                                >
                                  {url()}
                                </button>
                              </>
                            )}
                          </Show>
                        )}
                      </Show>
                      <span>更新日</span>
                      <span>{relDay(lib(), a().moved)}</span>
                    </div>
                  </details>
                </ScrollArea>
              </aside>
              <Show when={picking()}>
                <TagPicker
                  ref={coverPage}
                  class={styles.picker}
                  style={at()}
                  tags={a().tags}
                  all={allTags()}
                  recent={recent()}
                  suggested={suggested.state === 'ready' ? suggested() : undefined}
                  anchor={button()}
                  onToggle={(t, on) => props.onTag?.(a().id, t, on)}
                  onClose={closePicker}
                />
              </Show>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
