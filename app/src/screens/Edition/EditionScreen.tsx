import { For, Index, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
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
  coverTile,
  hasTag,
  scoreOf,
  thumbOf,
} from '../../model/library'
import shared from '../screen.module.css'
import styles from './EditionScreen.module.css'

/** 動いた日で分ける段。新しいほど大きく出す。clock は動画のホバー再生で時刻を出すか。 */
const TIERS: { name: string; until: number; size: CardSize; h: number; gap: number; clock: boolean }[] = [
  { name: '今週', until: 7, size: 'M', h: 118, gap: 6, clock: true },
  { name: '今月', until: 30, size: 'S', h: 76, gap: 5, clock: false },
  { name: 'それ以前', until: Infinity, size: 'X', h: 56, gap: 4, clock: false },
]

/** ピン留めの 1 枚。素材のときは thumb にその素材が入る。 */
type Pin = { key: string; name: string; meta: string; tiles: Item[]; thumb?: Item; open: () => void }
const FIRST = 36
const MORE = 30

export interface EditionScreenProps {
  lib: Library
  /** 開いたライブラリの場所。空のときに出す。 */
  location?: string
  pinnedProjects?: string[]
  pinnedTags?: string[]
  /** ピン留めを 2 行で切らず、全件を出している。 */
  pinsOpen?: boolean
  /** 開いたときのスクロール位置（スクロール後の見た目を確かめる）。 */
  scrollTop?: number
  onOpenItem?: (id: string) => void
  onOpenProject?: (name: string) => void
  onOpenTag?: (tag: string) => void
  /** 整理を開く。id を渡すと、その項目から見る。 */
  onTidy?: (id?: string) => void
}

/** 00 ホーム。承認待ちの最近追加したもの、ピン留め、動いた日で分けた段。 */
export function EditionScreen(props: EditionScreenProps) {
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const lib = () => props.lib
  const recent = createMemo(() => lib().pending())
  const pins = createMemo<Pin[]>(() => [
    ...(props.pinnedProjects ?? []).flatMap((n) => {
      const p = lib().projectBy.get(n)
      if (!p) return []
      const n2 = lib().inProject(n).length
      return [
        {
          key: `p:${n}`,
          name: n,
          meta: `プロジェクト · ${n2} 件`,
          tiles: coverOf(lib(), p, 5),
          open: () => props.onOpenProject?.(n),
        },
      ]
    }),
    ...(props.pinnedTags ?? []).flatMap((t) => {
      const list = lib()
        .items.filter((i) => !i.note && hasTag(i, t))
        .toSorted((a, b) => a.moved - b.moved)
      if (!list.length) return []
      return [
        {
          key: `t:${t}`,
          name: `# ${t}`,
          meta: `タグ · ${list.length} 件`,
          tiles: list.slice(0, 5),
          open: () => props.onOpenTag?.(t),
        },
      ]
    }),
    // プロジェクトに入っていないものだけ出す
    ...lib().pins.flatMap((id) => {
      const it = lib().byId.get(id)
      if (!it || it.folder) return []
      return [
        {
          key: `i:${it.id}`,
          name: it.name,
          meta: it.note ? 'ノート' : `素材 · ${lib().formatLabel(it)}`,
          tiles: [],
          thumb: it,
          open: () => props.onOpenItem?.(it.id),
        },
      ]
    }),
  ])
  // 段ごとに、重みの大きい順 → 新しい順に並べて、先頭から続けて出す
  const feed = createMemo(() =>
    TIERS.flatMap((tier, k) => {
      const from = k ? (TIERS[k - 1]?.until ?? 0) : -Infinity
      const list = lib()
        .items.filter((i) => i.moved > from && i.moved <= tier.until)
        .toSorted((a, b) => scoreOf(lib(), b) - scoreOf(lib(), a) || a.moved - b.moved)
      return list.map((it) => ({ tier, it, n: list.length }))
    }),
  )
  // ピン留めは 2 行までにし、残りは「全件を表示」で出す
  const preview = useHoverPreview()
  const [cols, setCols] = createSignal(3)
  const [pinsOpen, setPinsOpen] = createSignal(!!props.pinsOpen)
  const pinLimit = () => cols() * 2
  const shownPins = () => (pinsOpen() ? pins() : pins().slice(0, pinLimit()))
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
                    <Icon name="chevron" size={14} />
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
                    {(p) => (
                      <PinnedCard
                        name={p().name}
                        meta={p().meta}
                        tiles={p().tiles.map(coverTile)}
                        thumb={p().thumb && thumbOf(p().thumb!, 'L')}
                        onClick={() => p().open()}
                      />
                    )}
                  </Index>
                </div>
                <Show when={pins().length > pinLimit()}>
                  <div class={styles.pinsMore}>
                    <button type="button" aria-expanded={pinsOpen()} onClick={() => setPinsOpen(!pinsOpen())}>
                      {pinsOpen() ? '折りたたむ' : `すべて表示（${pins().length} 件）`}
                    </button>
                  </div>
                </Show>
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
                <span class={styles.spin} aria-hidden="true" />
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
