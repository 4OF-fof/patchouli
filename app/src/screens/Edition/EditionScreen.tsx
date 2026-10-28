import { For, Index, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Spinner } from '../../components/base/Spinner/Spinner'
import { useHoverPreview } from '../../components/media/HoverPreview/HoverPreview'
import { ItemCard } from '../../components/media/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { Icon } from '../../components/base/Icon/Icon'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { PinnedCard } from '../../components/media/PinnedCard/PinnedCard'
import { SectionLabel } from '../../components/base/SectionLabel/SectionLabel'
import { ThumbStrip } from '../../components/media/ThumbStrip/ThumbStrip'
import {
  type CardSize,
  type Item,
  type Library,
  coverOf,
  coverOrder,
  coverTile,
  newerFirst,
  hasTag,
  thumbOf,
} from '../../model/library'
import shared from '../screen.module.css'
import styles from './EditionScreen.module.css'

const TIERS: { name: string; until: number; size: CardSize; h: number; gap: number; clock: boolean }[] = [
  { name: '今週', until: 7, size: 'M', h: 118, gap: 6, clock: true },
  { name: '今月', until: 30, size: 'S', h: 76, gap: 5, clock: false },
  { name: 'それ以前', until: Infinity, size: 'X', h: 56, gap: 4, clock: false },
]

type Pin = { key: string; name: string; meta: string; moved: number; tiles: Item[]; thumb?: Item; open: () => void }
const FIRST = 36
const MORE = 30

export interface EditionScreenProps {
  lib: Library
  location?: string
  pinnedProjects?: string[]
  pinnedTags?: string[]
  pinsOpen?: boolean
  scrollTop?: number
  onOpenItem?: (id: string) => void
  onOpenProject?: (name: string) => void
  onOpenTag?: (tag: string) => void
  onTidy?: (id?: string) => void
}

export function EditionScreen(props: EditionScreenProps) {
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const lib = () => props.lib
  const recent = createMemo(() => lib().pending())
  const pins = createMemo<Pin[]>(() =>
    [
      ...(props.pinnedProjects ?? []).flatMap((n) => {
        const p = lib().projectBy.get(n)
        if (!p) return []
        const inside = lib().inProject(n)
        return [
          {
            key: `p:${n}`,
            name: n,
            meta: `プロジェクト · ${inside.length} 件`,
            moved: Math.min(...inside.map((i) => i.moved)),
            tiles: coverOf(lib(), p, 5),
            open: () => props.onOpenProject?.(n),
          },
        ]
      }),
      ...(props.pinnedTags ?? []).flatMap((t) => {
        const list = lib()
          .items.filter((i) => !i.note && hasTag(i, t))
          .toSorted(coverOrder(lib()))
        if (!list.length) return []
        return [
          {
            key: `t:${t}`,
            name: `# ${t}`,
            meta: `タグ · ${list.length} 件`,
            moved: Math.min(...list.map((i) => i.moved)),
            tiles: list.slice(0, 5),
            open: () => props.onOpenTag?.(t),
          },
        ]
      }),
      ...lib().pins.flatMap((id) => {
        const it = lib().byId.get(id)
        if (!it || it.folder) return []
        return [
          {
            key: `i:${it.id}`,
            name: it.name,
            meta: it.note ? 'ノート' : `素材 · ${lib().formatLabel(it)}`,
            moved: it.moved,
            tiles: [],
            thumb: it,
            open: () => props.onOpenItem?.(it.id),
          },
        ]
      }),
    ].toSorted((a, b) => a.moved - b.moved),
  )
  const feed = createMemo(() =>
    TIERS.flatMap((tier, k) => {
      const from = k ? (TIERS[k - 1]?.until ?? 0) : -Infinity
      const list = lib()
        .items.filter((i) => i.moved > from && i.moved <= tier.until)
        .toSorted(newerFirst)
      return list.map((it) => ({ tier, it, n: list.length }))
    }),
  )
  const preview = useHoverPreview()
  const [cols, setCols] = createSignal(3)
  const [pinsOpen, setPinsOpen] = createSignal(!!props.pinsOpen)
  const large = () => cols() >= 3
  const pinLimit = () => cols() * 2 - (large() ? 3 : 0)
  const pinsOver = () => pins().length > pinLimit()
  const shownPins = () => (pinsOpen() || !pinsOver() ? pins() : pins().slice(0, pinLimit() - 1))
  const watchCols = (el: HTMLDivElement) => {
    const ro = new ResizeObserver(() => setCols(getComputedStyle(el).gridTemplateColumns.split(' ').length))
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  }

  const [shown, setShown] = createSignal(FIRST)
  const tiers = createMemo(() => {
    const out: { tier: (typeof TIERS)[number]; n: number; items: Item[] }[] = []
    for (const f of feed().slice(0, shown())) {
      const last = out.at(-1)
      if (last?.tier === f.tier) last.items.push(f.it)
      else out.push({ tier: f.tier, n: f.n, items: [f.it] })
    }
    return out
  })

  // 下の端から 1 画面分先までを、待たずに埋める。足すと段の最後の行が組み直されるので、見える前に済ませる
  const fill = () => {
    const end = more
    if (!end) return
    const limit = scroll.getBoundingClientRect().bottom + scroll.clientHeight
    while (shown() < feed().length && end.getBoundingClientRect().top < limit) setShown(shown() + MORE)
  }
  onMount(() => {
    if (props.scrollTop) scroll.scrollTop = props.scrollTop
    // onMount の中で足しても描き直しが後回しになるので、描く前に走るマイクロタスクで埋める
    queueMicrotask(fill)
    // 見える・見えないの切り替わりで知らせる IntersectionObserver は、足し終えた位置が見張る範囲の端に重なると
    // それきり知らせが来なくなるので、スクロールと大きさの変化のたびに確かめる
    const ro = new ResizeObserver(fill)
    ro.observe(scroll)
    scroll.addEventListener('scroll', fill, { passive: true })
    onCleanup(() => {
      ro.disconnect()
      scroll.removeEventListener('scroll', fill)
    })
  })

  return (
    <section class={shared.screen} aria-label="ホーム">
      <ScrollArea class={shared.scroll} ref={scroll}>
        <Show
          when={lib().items.length}
          fallback={
            <div class={styles.empty}>
              <Icon name="box" class={styles.emptyIcon} />
              <b class={styles.emptyTitle}>まだ項目がありません</b>
              <p class={styles.emptyText}>
                ファイルをここにドロップするか、<Kbd class={styles.emptyKey}>Ctrl N</Kbd>でノートを作成できます
              </p>
              <Show when={props.location}>
                {(l) => (
                  <div class={styles.emptyPlace}>
                    {l().split(/[\\/]/).findLast(Boolean)} · {l()}
                  </div>
                )}
              </Show>
            </div>
          }
        >
          <div class={styles.ed}>
            <Show when={recent().length}>
              <section class={styles.recent} aria-label="最近追加した項目">
                <div class={styles.recentHead}>
                  <b>最近追加した項目</b>
                  <span>タグの承認待ち {recent().length} 件</span>
                  <button type="button" class={styles.tidy} onClick={() => props.onTidy?.()}>
                    分類結果を確認
                    <Icon name="chevron" size={14} withText />
                  </button>
                </div>
                <ThumbStrip
                  class={styles.strip}
                  items={recent()}
                  overflow="clip"
                  onOpen={(it) => props.onTidy?.(it.id)}
                />
              </section>
            </Show>
            <Show when={pins().length}>
              <section>
                <SectionLabel label="ピン留め" count={pins().length} />
                <div class={styles.pins} ref={watchCols}>
                  <Index each={shownPins()}>
                    {(p, k) => (
                      <PinnedCard
                        large={large() && k === 0}
                        class={large() && k === 0 ? styles.hero : undefined}
                        name={p().name}
                        meta={p().meta}
                        tiles={p().tiles.map(coverTile)}
                        thumb={p().thumb && thumbOf(p().thumb!, 'L')}
                        onClick={() => p().open()}
                      />
                    )}
                  </Index>
                  <Show when={pinsOver()}>
                    <button
                      type="button"
                      class={styles.pinsMore}
                      aria-expanded={pinsOpen()}
                      aria-label={pinsOpen() ? undefined : `すべて表示（${pins().length} 件）`}
                      onClick={() => setPinsOpen(!pinsOpen())}
                    >
                      {pinsOpen() ? '折りたたむ' : `＋${pins().length - shownPins().length}`}
                    </button>
                  </Show>
                </div>
              </section>
            </Show>
            <Index each={tiers()}>
              {(t) => (
                <section>
                  <SectionLabel label={t().tier.name} count={t().n} />
                  <JustifiedRow height={t().tier.h} gap={t().tier.gap}>
                    <For each={t().items}>
                      {(it) => (
                        <ItemCard
                          {...thumbOf(it, t().tier.size)}
                          name={it.name}
                          ratio={it.ratio}
                          showName={false}
                          preview={preview(it, { clock: t().tier.clock })}
                          onClick={() => props.onOpenItem?.(it.id)}
                        />
                      )}
                    </For>
                  </JustifiedRow>
                </section>
              )}
            </Index>
            <div class={styles.more} ref={more}>
              <Show when={shown() < feed().length}>
                <Spinner />
                続きを読み込み中（<span class={styles.mono}>{feed().length}</span> 件中{' '}
                <span class={styles.mono}>{Math.min(shown(), feed().length)}</span> 件を表示）
              </Show>
            </div>
          </div>
        </Show>
      </ScrollArea>
    </section>
  )
}
