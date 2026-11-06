import { Portal } from 'solid-js/web'
import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Chip } from '../../components/controls/Chip/Chip'
import { PlaceSelect } from '../../components/controls/PlaceSelect/PlaceSelect'
import { TagPicker } from '../../components/controls/TagPicker/TagPicker'
import { TextList } from '../../components/controls/TextList/TextList'
import { FloatingCard } from '../../components/overlay/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { HeadingTree } from '../../components/nav/HeadingTree/HeadingTree'
import { LinkCaption, LinkNone, LinkRow } from '../../components/nav/LinkRow/LinkRow'
import { middleClick } from '../../components/nav/TabPane/newTab'
import { TopBar } from '../../components/overlay/TopBar/TopBar'
import { menuBelow, useItemMenu } from '../../components/media/Thumb/Thumb'
import { useTabActive, useTabShown } from '../../components/nav/TabPane/TabPane'
import { BarButton, useBarTools } from '../AppBar'
import {
  type Embed,
  NoteEditor,
  type NoteEditorApi,
  type NoteSyntax,
  type UrlPreview,
} from '../../components/editor/NoteEditor/NoteEditor'
import { type Item, type Library, type Place, headingsOf, placeOf, refsOf, relDay } from '../../model/library'
import { prefs } from '../../model/prefs'
import { useTagPicker } from '../useTagPicker'
import shared from '../screen.module.css'
import styles from './NoteScreen.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface NoteScreenProps {
  lib: Library
  noteId: string
  headsOpen?: boolean
  linksOpen?: boolean
  propsOpen?: boolean
  idle?: boolean
  onOpenRef?: (id: string) => void
  onOpenTag?: (tag: string) => void
  onTogglePin?: (id: string) => void
  onBody?: (id: string, body: string) => void
  /** 本文を書き換えたノートから離れたとき。ほかのノートに移ったときや、タブが見えなくなったとき。 */
  onLeave?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onMove?: (id: string, place: Place) => void
  onAliases?: (id: string, aliases: string[]) => void
  onTag?: (id: string, tag: string, on: boolean) => void
  recentTags?: string[]
  suggestTags?: (id: string) => Promise<string[]>
  onCreateNote?: (name: string, place: Place) => Promise<Item | undefined>
  embedOf?: (it: Item) => Promise<Embed | undefined>
  urlEmbedOf?: (url: string, image: boolean) => Promise<Embed | undefined>
  urlPreviewOf?: (url: string) => Promise<UrlPreview>
  syntax?: NoteSyntax
  onOpenPage?: (url: string) => void
  onImport?: (files: File[], place: Place) => Promise<Item[]>
  editorRef?: (api: NoteEditorApi | undefined) => void
}

const NARROW = '(max-width: 860px)'
/** 見出しのカードを本文の横に置ける、画面の幅（px）。狭いときはアイコンだけにして、押したら本文の上に重ねる。 */
const HEADS_SIDE = 820
/** 閉じた見出しのボタンに、名前と件数を出す画面の幅（px）。狭いと本文にかかるので、アイコンだけにする。 */
const HEADS_LABEL = 1140
const narrow = () => typeof matchMedia === 'function' && matchMedia(NARROW).matches

/** ファイル名に使えない文字と、末尾の . を消す。 */
export const fileSafe = (name: string) =>
  name
    // oxlint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\.+$/, '')
    .trim()

export function NoteScreen(props: NoteScreenProps) {
  const lib = () => props.lib
  const note = () => lib().byId.get(props.noteId)
  const [heads, setHeads] = createSignal(props.headsOpen ?? (prefs().headsOpen && !narrow()))
  const [links, setLinks] = createSignal(!!props.linksOpen)
  const [propsOpen, setPropsOpen] = createSignal(!!props.propsOpen)
  const active = useTabActive()
  const barTools = useBarTools()
  const inBar = () => (active() ? barTools() : undefined)
  const itemMenu = useItemMenu()
  const more = (e: MouseEvent & { currentTarget: HTMLElement }) => itemMenu?.open(props.noteId, menuBelow(e))
  let moreBtn: HTMLButtonElement | undefined
  let editor: NoteEditorApi | undefined
  // ライブラリはサムネイルが届くたびに作り直すので、本文が変わったときだけ数え直す
  const body = createMemo(() => note()?.body ?? '')
  const headings = createMemo(() => headingsOf(body()))
  const into = () => {
    const n = note()
    return n ? lib().backOf(n) : []
  }
  const from = createMemo(() => refsOf(body()))

  // 分割したペインでは窓より狭くなるので、窓ではなく画面の幅で見出しの出し方を変える
  const [width, setWidth] = createSignal(Infinity)
  const [floatHeads, setFloatHeads] = createSignal(false)
  const roomy = () => width() >= HEADS_SIDE
  const sideHeads = () => heads() && roomy()
  let section: HTMLElement | undefined
  onMount(() => {
    if (!section || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width))
    ro.observe(section)
    onCleanup(() => ro.disconnect())
  })
  const closeHeads = () => {
    setHeads(false)
    setFloatHeads(false)
  }
  onCleanup(() => props.editorRef?.(undefined))
  let edited: string | undefined
  const leave = () => {
    if (edited) props.onLeave?.(edited)
    edited = undefined
  }
  const shown = useTabShown()
  createEffect(on(() => props.noteId, leave, { defer: true }))
  createEffect(
    on(
      shown,
      (s) => {
        if (!s) leave()
      },
      { defer: true },
    ),
  )
  onCleanup(leave)

  const {
    picking,
    recent,
    toggle: togglePicker,
    close: closePicker,
    allTags,
    button,
    setButton,
  } = useTagPicker({ lib, recentTags: () => props.recentTags, reset: () => [props.noteId, propsOpen()] })
  const [suggested] = createResource(
    () => (picking() ? props.noteId : undefined),
    async (id) => (await props.suggestTags?.(id).catch(() => [])) ?? [],
  )

  const rename = (el: HTMLInputElement) => {
    const n = note()
    if (!n) return
    const name = fileSafe(el.value)
    el.value = name || n.name
    if (name && name !== n.name) props.onRename?.(n.id, name)
  }

  return (
    <Show when={note()}>
      {(n) => (
        <section
          ref={section}
          class={`${shared.screen} ${styles.root}`}
          data-idle={!!props.idle}
          data-heads={sideHeads()}
          data-bar={!!barTools() || undefined}
          aria-label="ノート"
        >
          <ScrollArea class={styles.scroll}>
            <article class={styles.doc}>
              <input
                class={styles.name}
                type="text"
                aria-label="ノートの名前"
                value={n().name}
                onKeyDown={(e) => {
                  if (e.isComposing) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    rename(e.currentTarget)
                    editor?.focus()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.currentTarget.value = n().name
                    e.currentTarget.blur()
                  }
                }}
                onBlur={(e) => rename(e.currentTarget)}
              />
              <button type="button" class={styles.props} onClick={() => setPropsOpen(!propsOpen())}>
                {propsOpen() ? '閉じる ▾' : '詳細 ▸'}
              </button>
              <Show when={propsOpen()}>
                <dl class={styles.panel}>
                  <dt>所属</dt>
                  <dd>
                    <PlaceSelect
                      lib={lib()}
                      aria-label="所属"
                      value={n()}
                      onChange={(to) => props.onMove?.(n().id, to)}
                    />
                  </dd>
                  <dt class={styles.top}>別名</dt>
                  <dd>
                    <TextList
                      name="別名"
                      values={n().aliases ?? []}
                      reject={(v) => v === n().name}
                      onChange={(list) => props.onAliases?.(n().id, list)}
                    />
                  </dd>
                  <dt>タグ</dt>
                  <dd class={`${styles.chips} ${styles.tags}`}>
                    <For each={n().tags}>
                      {(t) => (
                        <Chip
                          removeLabel={`# ${t} を削除`}
                          onClick={() => props.onOpenTag?.(t)}
                          {...middleClick(() => props.onOpenTag?.(t))}
                          onRemove={() => props.onTag?.(n().id, t, false)}
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
                    <Show when={picking()}>
                      <TagPicker
                        class={styles.picker}
                        tags={n().tags}
                        all={allTags()}
                        recent={recent()}
                        suggested={suggested.state === 'ready' ? suggested() : undefined}
                        anchor={button()}
                        onToggle={(t, add) => props.onTag?.(n().id, t, add)}
                        onClose={closePicker}
                      />
                    </Show>
                  </dd>
                  <dt>更新日</dt>
                  <dd>{relDay(lib(), n().moved)}</dd>
                </dl>
              </Show>
              <NoteEditor
                lib={lib()}
                noteId={n().id}
                place={placeOf(n())}
                value={body()}
                onChange={(md) => {
                  edited = n().id
                  props.onBody?.(n().id, md)
                }}
                onOpenRef={props.onOpenRef}
                onCreateNote={async (name) => props.onCreateNote?.(name, placeOf(n()))}
                embedOf={props.embedOf}
                urlEmbedOf={props.urlEmbedOf}
                urlPreviewOf={props.urlPreviewOf}
                syntax={props.syntax}
                onOpenPage={props.onOpenPage}
                onImport={props.onImport && ((files) => props.onImport?.(files, placeOf(n())) ?? Promise.resolve([]))}
                ref={(api) => {
                  editor = api
                  props.editorRef?.(api)
                }}
              />
            </article>
          </ScrollArea>

          <Show
            when={inBar()}
            keyed
            fallback={
              !barTools() && (
                <TopBar
                  class={styles.bar}
                  onMore={more}
                  actions={
                    <PinToggle
                      look="float"
                      pressed={lib().pins.includes(n().id)}
                      onClick={() => props.onTogglePin?.(n().id)}
                    />
                  }
                />
              )
            }
          >
            {(el) => (
              <Portal mount={el}>
                <span class={styles.barTools}>
                  <BarButton
                    label={lib().pins.includes(n().id) ? 'ピン留めを解除' : 'ピン留め'}
                    aria-pressed={lib().pins.includes(n().id)}
                    onClick={() => props.onTogglePin?.(n().id)}
                  >
                    <Icon name="pin" size={15} class={styles.pinGlyph} />
                  </BarButton>
                  <BarButton
                    ref={moreBtn}
                    label="その他"
                    aria-expanded={!!moreBtn && itemMenu?.anchor() === moreBtn}
                    onClick={more}
                  >
                    <Icon name="more" size={15} />
                  </BarButton>
                </span>
              </Portal>
            )}
          </Show>

          <Show
            when={sideHeads() || floatHeads()}
            fallback={
              <Show
                when={width() >= HEADS_LABEL}
                fallback={
                  <FloatingPill
                    class={`${styles.pill} ${styles.l}`}
                    icon
                    aria-label="見出し"
                    data-tip="見出し"
                    onClick={() => (roomy() ? setHeads(true) : setFloatHeads(true))}
                  >
                    <Icon name="list" size={14} />
                  </FloatingPill>
                }
              >
                <FloatingPill
                  class={`${styles.pill} ${styles.l}`}
                  count={headings().length}
                  onClick={() => setHeads(true)}
                >
                  <Icon name="list" size={14} withText />
                  見出し
                </FloatingPill>
              </Show>
            }
          >
            <aside class={`${styles.card} ${styles.l}`} data-float={!sideHeads() || undefined} aria-label="見出し">
              <ScrollArea viewClass={styles.cardView}>
                <FloatingCard
                  title={
                    <button type="button" class={styles.headTitle} onClick={() => editor?.scrollToHeading(-1)}>
                      {n().name}
                    </button>
                  }
                  onClose={closeHeads}
                >
                  <HeadingTree
                    headings={headings()}
                    onSelect={(i) => {
                      editor?.scrollToHeading(i)
                      setFloatHeads(false)
                    }}
                  />
                </FloatingCard>
              </ScrollArea>
            </aside>
          </Show>

          <Show
            when={links()}
            fallback={
              <FloatingPill
                class={`${styles.pill} ${styles.r}`}
                count={into().length + from().length}
                onClick={() => setLinks(true)}
              >
                リンク
              </FloatingPill>
            }
          >
            <aside class={`${styles.card} ${styles.r}`} aria-label="リンク">
              <ScrollArea viewClass={styles.cardView}>
                <FloatingCard title={`リンク ${into().length + from().length}`} onClose={() => setLinks(false)}>
                  <div>
                    <LinkCaption>このノートへのリンク</LinkCaption>
                    <Show when={into().length} fallback={<LinkNone>リンクはまだありません</LinkNone>}>
                      <For each={into()}>
                        {(x) => (
                          <LinkRow mark="←" label={x.name} sub="ノート" onClick={() => props.onOpenRef?.(x.id)} />
                        )}
                      </For>
                    </Show>
                  </div>
                  <div>
                    <LinkCaption>このノートからのリンク</LinkCaption>
                    <Show when={from().length} fallback={<LinkNone>リンクはまだありません</LinkNone>}>
                      <For each={from()}>
                        {(id) => {
                          const it = () => lib().byId.get(id)
                          return (
                            <LinkRow
                              mark="→"
                              label={it()?.name ?? id}
                              sub={!it() ? '見つかりません' : it()?.note ? 'ノート' : it()?.ext.toUpperCase()}
                              missing={!it()}
                              onClick={() => props.onOpenRef?.(id)}
                            />
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                </FloatingCard>
              </ScrollArea>
            </aside>
          </Show>
        </section>
      )}
    </Show>
  )
}
