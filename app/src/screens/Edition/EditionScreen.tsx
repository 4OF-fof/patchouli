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
const FIRST = 36
const MORE = 30

export interface EditionScreenProps {
  lib: Library
  pinnedProjects?: string[]
  pinnedTags?: string[]
  /** 開いたときのスクロール位置（スクロール後の見た目を確かめる）。 */
  scrollTop?: number
  onOpenItem?: (id: string) => void
  onOpenProject?: (name: string) => void
  onOpenTag?: (tag: string) => void
}

/** 00 紙面。ピン留めと、動いた日で分けた段。 */
export function EditionScreen(props: EditionScreenProps) {
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const lib = () => props.lib
  const pins = createMemo(() => [
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
    <section class={shared.screen} aria-label="紙面">
      <div class={shared.scroll} ref={scroll}>
        <Show
          when={lib().items.length}
          fallback={
            <div class={styles.empty}>
              <div class={styles.emptyDrop}>ここに素材を落とすと、最初の紙面ができる</div>
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
                <div class={styles.pins}>
                  <For each={pins()}>
                    {(p) => (
                      <PinnedCard
                        name={p.name}
                        meta={p.meta}
                        tiles={p.tiles.map((i) => ({ hue: i.hue, sat: i.sat }))}
                        onClick={p.open}
                      />
                    )}
                  </For>
                </div>
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
