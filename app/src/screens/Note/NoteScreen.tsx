import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { FloatingCard } from '../../components/overlay/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { HeadingTree } from '../../components/nav/HeadingTree/HeadingTree'
import { LinkCaption, LinkNone, LinkRow } from '../../components/nav/LinkRow/LinkRow'
import { TopBar } from '../../components/overlay/TopBar/TopBar'
import { type Embed, NoteEditor, type NoteEditorApi } from '../../components/editor/NoteEditor/NoteEditor'
import { type Item, type Library, headingsOf, refsOf, relDay } from '../../model/library'
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
  onTogglePin?: (id: string) => void
  onBody?: (id: string, body: string) => void
  onRename?: (id: string, name: string) => void
  onCreateNote?: (name: string, folder: string | null) => Promise<Item | undefined>
  embedOf?: (it: Item) => Promise<Embed | undefined>
  onImport?: (files: File[], folder: string | null) => Promise<Item[]>
  editorRef?: (api: NoteEditorApi | undefined) => void
}

const NARROW = '(max-width: 860px)'
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
  const [heads, setHeads] = createSignal(props.headsOpen ?? !narrow())
  const [links, setLinks] = createSignal(!!props.linksOpen)
  const [propsOpen, setPropsOpen] = createSignal(!!props.propsOpen)
  let editor: NoteEditorApi | undefined
  const body = () => note()?.body ?? ''
  const headings = () => headingsOf(body())
  const [section, setSection] = createSignal(-1)
  const into = () => {
    const n = note()
    return n ? lib().backOf(n) : []
  }
  const from = () => refsOf(body())

  onMount(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(NARROW)
    const close = () => mq.matches && setHeads(false)
    mq.addEventListener('change', close)
    onCleanup(() => mq.removeEventListener('change', close))
  })
  onCleanup(() => props.editorRef?.(undefined))

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
        <section class={shared.screen} data-idle={!!props.idle} data-heads={heads()} aria-label="ノート">
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
                <Show when={n().tags.length} fallback={<span>タグなし</span>}>
                  <For each={n().tags}>{(t) => <span class={styles.tag}># {t}</span>}</For>
                </Show>
                <span>
                  · 別名 {n().aliases?.length ?? 0} · {propsOpen() ? '閉じる ▾' : '詳細 ▸'}
                </span>
              </button>
              <Show when={propsOpen()}>
                <dl class={styles.panel}>
                  <dt>タグ</dt>
                  <dd>
                    <input type="text" value={n().tags.join(', ')} aria-label="タグ（カンマ区切り）" />
                  </dd>
                  <dt>別名</dt>
                  <dd>
                    <input type="text" value={(n().aliases ?? []).join(', ')} aria-label="別名（カンマ区切り）" />
                  </dd>
                  <dt>プロジェクト</dt>
                  <dd>{n().folder ?? 'なし'}</dd>
                  <dt>更新日</dt>
                  <dd>{relDay(lib(), n().moved)}</dd>
                </dl>
              </Show>
              <NoteEditor
                lib={lib()}
                noteId={n().id}
                folder={n().folder}
                value={body()}
                onChange={(md) => props.onBody?.(n().id, md)}
                onOpenRef={props.onOpenRef}
                onCreateNote={async (name) => props.onCreateNote?.(name, n().folder)}
                embedOf={props.embedOf}
                onImport={props.onImport && ((files) => props.onImport?.(files, n().folder) ?? Promise.resolve([]))}
                onSection={setSection}
                ref={(api) => {
                  editor = api
                  props.editorRef?.(api)
                }}
              />
            </article>
          </ScrollArea>

          <TopBar
            class={styles.bar}
            actions={
              <PinToggle
                look="float"
                pressed={lib().pins.includes(n().id)}
                onClick={() => props.onTogglePin?.(n().id)}
              />
            }
          />

          <Show
            when={heads()}
            fallback={
              <FloatingPill
                class={`${styles.pill} ${styles.l}`}
                count={headings().length}
                onClick={() => setHeads(true)}
              >
                <Icon name="list" size={14} />
                見出し
              </FloatingPill>
            }
          >
            <aside class={`${styles.card} ${styles.l}`} aria-label="見出し">
              <ScrollArea viewClass={styles.cardView}>
                <FloatingCard title={`見出し ${headings().length}`} onClose={() => setHeads(false)}>
                  <HeadingTree
                    title={n().name}
                    headings={headings()}
                    current={section()}
                    onSelect={(i) => editor?.scrollToHeading(i)}
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
                    <Show when={into().length} fallback={<LinkNone>まだありません</LinkNone>}>
                      <For each={into()}>
                        {(x) => (
                          <LinkRow mark="←" label={x.name} sub="ノート" onClick={() => props.onOpenRef?.(x.id)} />
                        )}
                      </For>
                    </Show>
                  </div>
                  <div>
                    <LinkCaption>このノートからのリンク</LinkCaption>
                    <Show when={from().length} fallback={<LinkNone>まだありません</LinkNone>}>
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
