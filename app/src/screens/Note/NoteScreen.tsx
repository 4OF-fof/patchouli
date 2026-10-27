import { For, type JSX, Show, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { FloatingCard } from '../../components/overlay/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { LinkCaption, LinkNone, LinkRow } from '../../components/overlay/LinkRow/LinkRow'
import { TopBar } from '../../components/overlay/TopBar/TopBar'
import { type Library, type NoteBlock, refsOfBlocks, relDay, splitLinks } from '../../model/library'
import shared from '../screen.module.css'
import styles from './NoteScreen.module.css'

export interface NoteScreenProps {
  lib: Library
  noteId: string
  /** 見出しのカードを開いている（広い窓では最初から開く）。 */
  headsOpen?: boolean
  /** つながりのカードを開いている。 */
  linksOpen?: boolean
  /** タグなどの欄を開いている。 */
  propsOpen?: boolean
  /** しばらく触っていない。上の帯とボタンを隠す。 */
  idle?: boolean
  /** [[名前]] のリンクや、つながりの行を押したとき。 */
  onOpenRef?: (name: string) => void
  /** ピン留めを切り替える。プロジェクトに入っていればその上に出る。 */
  onTogglePin?: (id: string) => void
}

/** 01 ノート。本文を真ん中に置き、見出しとつながりは端に浮かべる。 */
export function NoteScreen(props: NoteScreenProps) {
  const lib = () => props.lib
  const note = () => lib().byId.get(props.noteId)
  const [heads, setHeads] = createSignal(props.headsOpen ?? true)
  const [links, setLinks] = createSignal(!!props.linksOpen)
  const [propsOpen, setPropsOpen] = createSignal(!!props.propsOpen)
  const blocks = () => note()?.blocks ?? []
  const h2s = () => blocks().filter((b) => b.type === 'h2')
  const into = () => {
    const n = note()
    return n ? lib().backOf(n) : []
  }
  const from = () => refsOfBlocks(blocks())
  const inline = (text: string): JSX.Element => (
    <For each={splitLinks(text)}>
      {(s) =>
        'ref' in s ? (
          <button
            type="button"
            class={styles.wl}
            data-missing={!lib().byName.has(s.ref)}
            title="Ctrl クリックで開く"
            onClick={(e) => (e.ctrlKey || e.metaKey) && props.onOpenRef?.(s.ref)}
          >
            {s.ref}
          </button>
        ) : (
          s.text
        )
      }
    </For>
  )
  // 続いた li を 1 つの ul にまとめる
  const groups = () => {
    const out: (NoteBlock | NoteBlock[])[] = []
    for (const b of blocks()) {
      const last = out.at(-1)
      if (b.type === 'li' && Array.isArray(last)) last.push(b)
      else out.push(b.type === 'li' ? [b] : b)
    }
    return out
  }

  return (
    <Show when={note()}>
      {(n) => (
        <section class={shared.screen} data-idle={!!props.idle} data-heads={heads()} aria-label="ノート">
          <ScrollArea class={styles.scroll}>
            <article class={styles.doc}>
              <h1>{n().name}</h1>
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
              <div class={styles.body}>
                <For each={groups()}>
                  {(g) =>
                    Array.isArray(g) ? (
                      <ul>
                        <For each={g}>{(b) => <li>{inline(b.text)}</li>}</For>
                      </ul>
                    ) : g.type === 'h2' ? (
                      <h2>{inline(g.text)}</h2>
                    ) : (
                      <p>{inline(g.text)}</p>
                    )
                  }
                </For>
              </div>
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
              <FloatingPill class={`${styles.pill} ${styles.l}`} count={h2s().length} onClick={() => setHeads(true)}>
                ≡ 見出し
              </FloatingPill>
            }
          >
            <aside class={`${styles.card} ${styles.l}`} aria-label="見出し">
              <ScrollArea viewClass={styles.cardView}>
                <FloatingCard title={`≡ 見出し ${h2s().length}`} onClose={() => setHeads(false)}>
                  <div>
                    <LinkRow label={n().name} current />
                    <For each={h2s()}>{(h) => <LinkRow label={h.text} indent />}</For>
                  </div>
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
                <FloatingCard title={`リンク ${into().length + from().length} ⇄`} onClose={() => setLinks(false)}>
                  <div>
                    <LinkCaption>このノートへのリンク</LinkCaption>
                    <Show when={into().length} fallback={<LinkNone>まだありません</LinkNone>}>
                      <For each={into()}>
                        {(x) => (
                          <LinkRow mark="←" label={x.name} sub="ノート" onClick={() => props.onOpenRef?.(x.name)} />
                        )}
                      </For>
                    </Show>
                  </div>
                  <div>
                    <LinkCaption>このノートからのリンク</LinkCaption>
                    <Show when={from().length} fallback={<LinkNone>まだありません</LinkNone>}>
                      <For each={from()}>
                        {(name) => {
                          const it = lib().byName.get(name)
                          return (
                            <LinkRow
                              mark="→"
                              label={name}
                              sub={!it ? '未作成' : it.note ? 'ノート' : '素材'}
                              missing={!it}
                              onClick={() => props.onOpenRef?.(name)}
                            />
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                  <button type="button" class={styles.connect}>
                    ＋ リンクを追加
                  </button>
                </FloatingCard>
              </ScrollArea>
            </aside>
          </Show>
        </section>
      )}
    </Show>
  )
}
