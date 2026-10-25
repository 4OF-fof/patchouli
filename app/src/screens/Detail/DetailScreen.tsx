import { For, type JSX, Show, children, createMemo, createSignal } from 'solid-js'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { ItemCard } from '../../components/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/JustifiedRow/JustifiedRow'
import { Tabs } from '../../components/Tabs/Tabs'
import { type CardSize, type Item, thumbOf } from '../../model/library'
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
  /** 右の列で「すべて」より前に出すもの（ピン留めなど）。見出しに data-first を付けておく。 */
  top?: JSX.Element
  items: Item[]
  /** items が空のときの一言。 */
  empty?: JSX.Element
  /** カードを差し替えるとき（ピンを重ねるなど）。list はいまの並び。 */
  card?: (it: Item, size: CardSize, list: () => Item[]) => JSX.Element
  onOpenItem?: (id: string, list: string[]) => void
}

/** プロジェクトやタグの中身を見る画面の枠。上に名前、その下を左右 1:2 に分け、右にすべての項目を並べる。 */
export function DetailScreen(props: DetailScreenProps) {
  const [sort, setSort] = createSignal<Sort>('moved')
  const side = children(() => props.side)
  const top = children(() => props.top)
  const has = (c: typeof side) => c.toArray().some((x) => x != null)
  const all = createMemo(() =>
    props.items.toSorted(
      sort() === 'name'
        ? (a, b) => a.name.localeCompare(b.name, 'ja')
        : sort() === 'kind'
          ? (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.moved - b.moved
          : (a, b) => a.moved - b.moved,
    ),
  )
  const card = (it: Item, size: CardSize, list: () => Item[]) =>
    props.card?.(it, size, list) ?? (
      <ItemCard
        {...thumbOf(it, size)}
        name={it.name}
        ratio={it.ratio}
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
      <div class={shared.scroll}>
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
          <div class={styles.body} data-wide={!has(side) || undefined}>
            <Show when={has(side)}>
              <div class={styles.side} aria-label={props.sideLabel}>
                {side()}
              </div>
            </Show>
            <div>
              {top()}
              <div class={shared.head} data-first={!has(top) || undefined}>
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
      </div>
    </section>
  )
}
