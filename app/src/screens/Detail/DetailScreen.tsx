import { For, type JSX, Show, children, createMemo, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { useHoverPreview } from '../../components/media/HoverPreview/HoverPreview'
import { ItemCard } from '../../components/media/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { SelectArea, useSelection } from '../../components/media/Selection/Selection'
import { Tabs } from '../../components/controls/Tabs/Tabs'
import { type CardSize, type Item, newerFirst, thumbOf, toggled } from '../../model/library'
import { useFormats } from '../../plugins/formats'
import shared from '../screen.module.css'
import styles from './DetailScreen.module.css'

type Sort = 'moved' | 'name' | 'kind'

export interface DetailScreenProps {
  label: string
  title: JSX.Element
  meta: JSX.Element
  actions?: JSX.Element
  side?: JSX.Element
  sideLabel?: string
  items: Item[]
  empty?: JSX.Element
  pins?: string[]
  onTogglePin?: (id: string) => void
  onOpenItem?: (id: string, list: string[]) => void
}

export function DetailScreen(props: DetailScreenProps) {
  const [sort, setSort] = createSignal<Sort>('moved')
  const formats = useFormats()
  const sel = useSelection()
  const preview = useHoverPreview()
  const labelOf = (it: Item) => formats().get(it.ext)?.label ?? it.ext
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
          ? (a, b) => Number(b.note) - Number(a.note) || labelOf(a).localeCompare(labelOf(b), 'ja') || newerFirst(a, b)
          : newerFirst,
    ),
  )
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
  return (
    <section class={shared.screen} aria-label={props.label}>
      <ScrollArea class={shared.scroll}>
        <div class={shared.page}>
          <header class={shared.mast}>
            {props.title}
            <span class={shared.meta}>
              {props.meta}
              {sel?.ids().length ? ` · ${sel.ids().length} 件を選択中` : ''}
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
                <span>{props.items.length} 件</span>
                <Tabs
                  label="並び順"
                  value={sort()}
                  onChange={setSort}
                  items={[
                    { key: 'moved', label: '更新順' },
                    { key: 'name', label: '名前順' },
                    { key: 'kind', label: '種類順' },
                  ]}
                />
              </div>
              <Show when={all().length} fallback={<div class={shared.empty}>{props.empty}</div>}>
                <JustifiedRow height={104}>
                  <For each={all()}>{(it) => card(it, 'S', all, false)}</For>
                </JustifiedRow>
              </Show>
            </SelectArea>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
