import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { ItemCard } from '../../components/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/JustifiedRow/JustifiedRow'
import { Kbd } from '../../components/Kbd/Kbd'
import { PinnedCard } from '../../components/PinnedCard/PinnedCard'
import { SectionLabel } from '../../components/SectionLabel/SectionLabel'
import { type CardSize, type Item, type Library, coverOf, hasTag, scoreOf, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './EditionScreen.module.css'

/** 動いた日で分ける段。新しいほど大きく出す。 */
const TIERS: { name: string; until: number; size: CardSize; h: number; gap: number }[] = [
  { name: '今週', until: 7, size: 'M', h: 118, gap: 6 },
  { name: '今月', until: 30, size: 'S', h: 76, gap: 5 },
  { name: '静かなもの', until: Infinity, size: 'X', h: 56, gap: 4 },
]
const KIND_LABEL = { image: '画像', audio: '音声', video: '動画' }

/** ピン留めの 1 枚。素材のときは thumb にその素材が入る。 */
type Pin = { key: string; name: string; meta: string; tiles: Item[]; thumb?: Item; open: () => void }
const FIRST = 36
const MORE = 30

export interface EditionScreenProps {
  lib: Library
  pinnedProjects?: string[]
  pinnedTags?: string[]
  /** ピン留めした素材の名前。プロジェクトに入っているものは出さない。 */
  pinnedItems?: string[]
  /** ピン留めを 2 行で切らず、全件を出している。 */
  pinsOpen?: boolean
  /** 開いたときのスクロール位置（スクロール後の見た目を確かめる）。 */
  scrollTop?: number
  onOpenItem?: (id: string) => void
  onOpenProject?: (name: string) => void
  onOpenTag?: (tag: string) => void
}

/** 00 ホーム。ピン留めと、動いた日で分けた段。 */
export function EditionScreen(props: EditionScreenProps) {
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const lib = () => props.lib
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
        .items.filter((i) => i.kind !== 'note' && hasTag(i, t))
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
    ...(props.pinnedItems ?? []).flatMap((n) => {
      const it = lib().byName.get(n)
      if (!it || it.kind === 'note' || it.folder) return []
      return [
        {
          key: `i:${it.id}`,
          name: it.name,
          meta: `素材 · ${KIND_LABEL[it.kind]}`,
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

  // 下まで来たら少し待って続きを足す
  let timer = 0
  onMount(() => {
    if (props.scrollTop) scroll.scrollTop = props.scrollTop
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting) || timer || shown() >= feed().length) return
        timer = window.setTimeout(() => {
          timer = 0
          setShown(shown() + MORE)
        }, 380)
      },
      { root: scroll, rootMargin: '0px 0px 240px 0px' },
    )
    if (more) io.observe(more)
    onCleanup(() => {
      io.disconnect()
      clearTimeout(timer)
    })
  })

  return (
    <section class={shared.screen} aria-label="ホーム">
      <div class={shared.scroll} ref={scroll}>
        <Show
          when={lib().items.length}
          fallback={
            <div class={styles.empty}>
              <div class={styles.emptyDrop}>ここに素材を落とすと、ホームに並ぶ</div>
              <div class={styles.emptyHint}>
                ノートから始めるなら<Kbd>Ctrl N</Kbd>
              </div>
            </div>
          }
        >
          <div class={styles.ed}>
            <Show when={pins().length}>
              <section>
                <SectionLabel label="ピン留め" count={pins().length} />
                <div class={styles.pins} ref={watchCols}>
                  <For each={shownPins()}>
                    {(p) => (
                      <PinnedCard
                        name={p.name}
                        meta={p.meta}
                        tiles={p.tiles.map((i) => ({ hue: i.hue, sat: i.sat }))}
                        thumb={p.thumb && thumbOf(p.thumb, 'L')}
                        onClick={p.open}
                      />
                    )}
                  </For>
                </div>
                <Show when={pins().length > pinLimit()}>
                  <div class={styles.pinsMore}>
                    <button type="button" aria-expanded={pinsOpen()} onClick={() => setPinsOpen(!pinsOpen())}>
                      {pinsOpen() ? 'たたむ' : `全件を表示（${pins().length} 件）`}
                    </button>
                  </div>
                </Show>
              </section>
            </Show>
            <For each={tiers()}>
              {(t) => (
                <section>
                  <SectionLabel label={t.tier.name} count={t.n} />
                  <JustifiedRow height={t.tier.h} gap={t.tier.gap}>
                    <For each={t.items}>
                      {(it) => (
                        <ItemCard
                          {...thumbOf(it, t.tier.size)}
                          name={it.name}
                          ratio={it.ratio}
                          showName={false}
                          onClick={() => props.onOpenItem?.(it.id)}
                        />
                      )}
                    </For>
                  </JustifiedRow>
                </section>
              )}
            </For>
            <div class={styles.more} ref={more}>
              <Show
                when={shown() < feed().length}
                fallback={
                  <>
                    ここで全件です（<span class={styles.mono}>{feed().length}</span> 件）
                  </>
                }
              >
                <span class={styles.spin} aria-hidden="true" />
                続きを読み込み中（<span class={styles.mono}>{feed().length}</span> 件中{' '}
                <span class={styles.mono}>{Math.min(shown(), feed().length)}</span> 件を表示）
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </section>
  )
}
