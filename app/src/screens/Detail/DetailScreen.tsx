import { For, type JSX, Show, children, createEffect, createMemo, createSignal, on } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Spinner } from '../../components/base/Spinner/Spinner'
import { useHoverPreview } from '../../components/media/HoverPreview/HoverPreview'
import { Button } from '../../components/controls/Button/Button'
import { GroupCard } from '../../components/media/GroupCard/GroupCard'
import { ItemCard } from '../../components/media/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { SelectArea, useSelection } from '../../components/media/Selection/Selection'
import { type ItemFilter, NO_FILTER, filtering, matcher, sorter } from '../../model/filter'
import { type CardSize, type Group, type Item, type Library, facesOf, thumbOf, toggled } from '../../model/library'
import { useFill } from '../useFill'
import shared from '../screen.module.css'
import { type Sort, prefs } from '../../model/prefs'
import { ListTools, useKindOf } from '../ListTools/ListTools'
import styles from './DetailScreen.module.css'

const FIRST = 60
const MORE = 60

export interface DetailScreenProps {
  label: string
  title: JSX.Element
  meta: JSX.Element
  actions?: JSX.Element
  side?: JSX.Element
  sideLabel?: string
  items: Item[]
  /** 項目の前に並べるグループ。faces と件数を引くのに lib が要る */
  groups?: Group[]
  lib?: Library
  /** 渡すと、グループの中も平らに並べるかを切り替えられる */
  flat?: boolean
  onFlat?: (on: boolean) => void
  onOpenGroup?: (id: string) => void
  empty?: JSX.Element
  pins?: string[]
  /** ピン留めを拾う範囲。省くと items から拾う */
  pinFrom?: Item[]
  onTogglePin?: (id: string) => void
  onOpenItem?: (id: string, list: string[]) => void
}

export function DetailScreen(props: DetailScreenProps) {
  const [sort, setSort] = createSignal<Sort>(prefs().sort)
  const [filter, setFilter] = createSignal<ItemFilter>(NO_FILTER)
  const kindOf = useKindOf()
  const sel = useSelection()
  const preview = useHoverPreview()
  const match = createMemo(() => matcher(filter()))
  const side = children(() => props.side)
  const hasSide = () => side.toArray().some((x) => x != null)
  const [pins, setPins] = createSignal(props.pins ?? [])
  createEffect(
    on(
      () => props.pins,
      (p) => setPins(p ?? []),
      { defer: true },
    ),
  )
  const pinned = createMemo(() => {
    const here = new Map((props.pinFrom ?? props.items).map((i) => [i.id, i]))
    return pins()
      .flatMap((id) => here.get(id) ?? [])
      .filter(match())
  })
  const togglePin = (id: string) => {
    setPins(toggled(pins(), id))
    props.onTogglePin?.(id)
  }
  const all = createMemo(() => props.items.filter(match()).toSorted(sorter(sort(), kindOf)))
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const { shown, fill } = useFill({
    scroll: () => scroll,
    end: () => more,
    total: () => all().length,
    first: FIRST,
    more: MORE,
  })
  const visible = () => all().slice(0, shown())
  createEffect(() => {
    void all()
    queueMicrotask(fill)
  })
  const card = (it: Item, size: CardSize, list: () => Item[], clock: boolean) => (
    <ItemCard
      {...thumbOf(it, size)}
      name={it.name}
      ratio={it.ratio}
      pinned={pins().includes(it.id)}
      onPin={() => togglePin(it.id)}
      preview={preview(it, { clock })}
      onClick={() =>
        props.onOpenItem?.(
          it.id,
          list().map((x) => x.id),
        )
      }
    />
  )
  const groups = () =>
    (filtering(filter()) ? [] : (props.groups ?? [])).toSorted((a, b) => a.name.localeCompare(b.name, 'ja'))
  const groupCard = (g: Group) => (
    <GroupCard
      name={g.name}
      count={props.lib?.inGroup(g.id).length ?? 0}
      faces={props.lib ? facesOf(props.lib, g.id).map((it) => thumbOf(it, 'S')) : []}
      onClick={() => props.onOpenGroup?.(g.id)}
    />
  )
  return (
    <section class={shared.screen} aria-label={props.label}>
      <ScrollArea class={shared.scroll} ref={scroll}>
        <div class={shared.page}>
          <header class={shared.mast}>
            {props.title}
            <span class={shared.meta}>
              {props.meta}
              {sel?.ids().length ? ` | ${sel.ids().length} 件を選択中` : ''}
            </span>
            <Show when={props.actions}>
              <span class={`${shared.end} ${shared.actions}`}>{props.actions}</span>
            </Show>
          </header>
          <div class={styles.body} data-wide={!hasSide() || undefined}>
            <Show when={hasSide()}>
              <div class={styles.side} aria-label={props.sideLabel}>
                {side()}
              </div>
            </Show>
            <SelectArea order={() => all().map((x) => x.id)}>
              <Show when={pinned().length}>
                <div class={shared.head} data-first>
                  <h2>ピン留め</h2>
                  <span>{pinned().length} 件</span>
                </div>
                <JustifiedRow height={196} gap={10}>
                  <For each={pinned()}>{(it) => card(it, 'M', pinned, true)}</For>
                </JustifiedRow>
              </Show>
              <div class={shared.head} data-first={!pinned().length || undefined}>
                <h2>すべて</h2>
                <span>{filtering(filter()) ? `${all().length} / ${props.items.length}` : props.items.length} 件</span>
                <ListTools items={props.items} sort={sort()} onSort={setSort} filter={filter()} onFilter={setFilter} />
                <Show when={props.onFlat}>
                  <Button size="sm" variant="ghost" pressed={!!props.flat} onClick={() => props.onFlat?.(!props.flat)}>
                    フォルダを展開
                  </Button>
                </Show>
              </div>
              <Show
                when={all().length || groups().length}
                fallback={
                  <div class={shared.empty}>{filtering(filter()) ? '一致する項目がありません' : props.empty}</div>
                }
              >
                <JustifiedRow height={104}>
                  <For each={groups()}>{(g) => groupCard(g)}</For>
                  <For each={visible()}>{(it) => card(it, 'S', all, false)}</For>
                </JustifiedRow>
              </Show>
              <div class={styles.more} ref={more}>
                <Show when={shown() < all().length}>
                  <Spinner />
                  続きを読み込み中
                </Show>
              </div>
            </SelectArea>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
