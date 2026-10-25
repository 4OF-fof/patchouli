import { For, type JSX, Show, children, createMemo, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { ItemCard } from '../../components/media/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { Tabs } from '../../components/controls/Tabs/Tabs'
import { type CardSize, type Item, thumbOf, toggled } from '../../model/library'
import shared from '../screen.module.css'
import styles from './DetailScreen.module.css'

type Sort = 'moved' | 'name' | 'kind'
const KIND_ORDER = { note: 0, image: 1, video: 2, audio: 3 }

export interface DetailScreenProps {
  /** 画面の読み上げ名（例「プロジェクト」「タグ」）。 */
  label: string
  title: JSX.Element
  meta: JSX.Element
  backLabel?: string
  onBack?: () => void
  /** 右上に置く操作。 */
  actions?: JSX.Element
  /** 左の列に積む部品。何もなければ右の列が全幅になる。 */
  side?: JSX.Element
  sideLabel?: string
  items: Item[]
  /** items が空のときの一言。 */
  empty?: JSX.Element
  /** ピン留めした項目の id（ライブラリ全体）。items に入っているものを「すべて」より前に出す。 */
  pins?: string[]
  onTogglePin?: (id: string) => void
  onOpenItem?: (id: string, list: string[]) => void
}

/** プロジェクトやタグの中身を見る画面の枠。上に名前、その下を左右 1:2 に分け、右にピン留めとすべての項目を並べる。 */
export function DetailScreen(props: DetailScreenProps) {
  const [sort, setSort] = createSignal<Sort>('moved')
  const side = children(() => props.side)
  const hasSide = () => side.toArray().some((x) => x != null)
  const [pins, setPins] = createSignal(props.pins ?? [])
  const pinned = createMemo(() => {
    const here = new Map(props.items.map((i) => [i.id, i]))
    return pins().flatMap((id) => here.get(id) ?? [])
  })
  const togglePin = (id: string) => {
    setPins(toggled(pins(), id))
    props.onTogglePin?.(id)
  }
  const all = createMemo(() =>
    props.items.toSorted(
      sort() === 'name'
        ? (a, b) => a.name.localeCompare(b.name, 'ja')
        : sort() === 'kind'
          ? (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.moved - b.moved
          : (a, b) => a.moved - b.moved,
    ),
  )
  const card = (it: Item, size: CardSize, list: () => Item[]) => (
    <ItemCard
      {...thumbOf(it, size)}
      name={it.name}
      ratio={it.ratio}
      pinned={pins().includes(it.id)}
      onPin={() => togglePin(it.id)}
      onClick={() =>
        props.onOpenItem?.(
          it.id,
          list().map((x) => x.id),
        )
      }
    />
  )
  return (
    <section class={shared.screen} aria-label={props.label}>
      <ScrollArea class={shared.scroll}>
        <div class={shared.page}>
          <header class={shared.mast}>
            <FloatingPill class={shared.back} onClick={() => props.onBack?.()}>
              ‹ {props.backLabel ?? 'ホーム'}
            </FloatingPill>
            {props.title}
            <span class={shared.meta}>{props.meta}</span>
            <Show when={props.actions}>
              <span class={shared.right}>{props.actions}</span>
            </Show>
          </header>
          <div class={styles.body} data-wide={!hasSide() || undefined}>
            <Show when={hasSide()}>
              <div class={styles.side} aria-label={props.sideLabel}>
                {side()}
              </div>
            </Show>
            <div>
              <Show when={pinned().length}>
                <div class={shared.head} data-first>
                  <h2>ピン留め</h2>
                  <span>{pinned().length} 件 · ピン留めした順</span>
                </div>
                <JustifiedRow height={196} gap={10}>
                  <For each={pinned()}>{(it) => card(it, 'M', pinned)}</For>
                </JustifiedRow>
              </Show>
              <div class={shared.head} data-first={!pinned().length || undefined}>
                <h2>すべて</h2>
                <span>{props.items.length} 件</span>
                <Tabs
                  label="並べ方"
                  value={sort()}
                  onChange={setSort}
                  items={[
                    { key: 'moved', label: '動いた順' },
                    { key: 'name', label: '名前順' },
                    { key: 'kind', label: '種類' },
                  ]}
                />
              </div>
              <Show when={all().length} fallback={<div class={shared.empty}>{props.empty}</div>}>
                <JustifiedRow height={104}>
                  <For each={all()}>{(it) => card(it, 'S', all)}</For>
                </JustifiedRow>
              </Show>
            </div>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
