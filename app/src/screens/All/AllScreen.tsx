import { For, Show, createMemo, createSignal } from 'solid-js'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Spinner } from '../../components/base/Spinner/Spinner'
import { Button } from '../../components/controls/Button/Button'
import { GroupCard } from '../../components/media/GroupCard/GroupCard'
import { useHoverPreview } from '../../components/media/HoverPreview/HoverPreview'
import { ItemCard } from '../../components/media/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { SelectArea, useSelection } from '../../components/media/Selection/Selection'
import { type ItemFilter, NO_FILTER, filtering, matcher, sorter } from '../../model/filter'
import { type Item, type Library, facesOf, thumbOf } from '../../model/library'
import { type Sort, prefs } from '../../model/prefs'
import { ListTools, useKindOf } from '../ListTools/ListTools'
import { useFill } from '../useFill'
import shared from '../screen.module.css'
import styles from './AllScreen.module.css'

const FIRST = 48
const MORE = 40

export interface AllScreenProps {
  lib: Library
  onOpenItem?: (id: string, list: string[]) => void
  onOpenGroup?: (id: string) => void
  onTogglePin?: (id: string) => void
}

export function AllScreen(props: AllScreenProps) {
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const lib = () => props.lib
  const preview = useHoverPreview()
  const sel = useSelection()
  const kindOf = useKindOf()
  const [flat, setFlat] = createSignal(false)
  const [sort, setSort] = createSignal<Sort>(prefs().sort)
  const [filter, setFilter] = createSignal<ItemFilter>(NO_FILTER)
  const scope = createMemo(() => (flat() ? lib().items : lib().items.filter((i) => i.group === null)))
  const all = createMemo(() => {
    const pins = new Map(lib().pins.map((id, i) => [id, i]))
    const rank = (id: string) => pins.get(id) ?? pins.size
    const by = sorter(sort(), kindOf)
    return scope()
      .filter(matcher(filter()))
      .toSorted((a, b) => rank(a.id) - rank(b.id) || by(a, b))
  })
  const groups = () =>
    flat() || filtering(filter())
      ? []
      : lib()
          .groups.filter((g) => g.parent === null)
          .toSorted((a, b) => a.name.localeCompare(b.name, 'ja'))
  const pinCount = createMemo(() => {
    const pins = new Set(lib().pins)
    return all().filter((it) => pins.has(it.id)).length
  })
  const { shown } = useFill({
    scroll: () => scroll,
    end: () => more,
    total: () => all().length,
    first: FIRST,
    more: MORE,
  })
  const visible = () => all().slice(0, shown())
  const itemCard = (it: Item) => (
    <ItemCard
      {...thumbOf(it, 'M')}
      name={it.name}
      ratio={it.ratio}
      pinned={lib().pins.includes(it.id)}
      onPin={() => props.onTogglePin?.(it.id)}
      preview={preview(it, { clock: true })}
      onClick={() =>
        props.onOpenItem?.(
          it.id,
          all().map((x) => x.id),
        )
      }
    />
  )

  return (
    <section class={shared.screen} aria-label="すべて">
      <ScrollArea class={shared.scroll} ref={scroll}>
        <SelectArea class={shared.page} order={() => all().map((x) => x.id)}>
          <header class={shared.mast}>
            <h1>すべて</h1>
            <span class={shared.meta}>
              {filtering(filter()) ? `${all().length} / ${scope().length}` : lib().items.length} 件
              {sel?.ids().length ? ` | ${sel.ids().length} 件を選択中` : ''}
            </span>
            <span class={`${shared.end} ${shared.actions}`}>
              <ListTools items={scope()} sort={sort()} onSort={setSort} filter={filter()} onFilter={setFilter} />
              <Button size="sm" variant="ghost" pressed={flat()} onClick={() => setFlat(!flat())}>
                フォルダを展開
              </Button>
            </span>
          </header>
          <Show
            when={all().length || groups().length}
            fallback={
              <div class={styles.body}>
                <NoneText>{filtering(filter()) ? '一致する項目がありません' : 'まだ項目がありません'}</NoneText>
              </div>
            }
          >
            <div class={styles.body}>
              <JustifiedRow height={140}>
                <For each={visible().slice(0, pinCount())}>{itemCard}</For>
                <For each={groups()}>
                  {(g) => (
                    <GroupCard
                      name={g.name}
                      count={lib().inGroup(g.id).length}
                      faces={facesOf(lib(), g.id).map((it) => thumbOf(it, 'M'))}
                      onClick={() => props.onOpenGroup?.(g.id)}
                    />
                  )}
                </For>
                <For each={visible().slice(pinCount())}>{itemCard}</For>
              </JustifiedRow>
            </div>
          </Show>
          <div class={styles.more} ref={more}>
            <Show when={shown() < all().length}>
              <Spinner />
              続きを読み込み中
            </Show>
          </div>
        </SelectArea>
      </ScrollArea>
    </section>
  )
}
