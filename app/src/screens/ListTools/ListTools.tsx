import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Icon } from '../../components/base/Icon/Icon'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Button } from '../../components/controls/Button/Button'
import { Chip } from '../../components/controls/Chip/Chip'
import { NavMenu } from '../../components/nav/NavMenu/NavMenu'
import { useTabActive } from '../../components/nav/TabPane/TabPane'
import { type ItemFilter, NO_FILTER, counted, filtering } from '../../model/filter'
import { type Item, NOTE_LABEL, toggled } from '../../model/library'
import type { Sort } from '../../model/prefs'
import { useFormats } from '../../plugins/formats'
import { BarButton, useBarTools } from '../AppBar'
import styles from './ListTools.module.css'

export const useKindOf = () => {
  const formats = useFormats()
  return (it: Item) => (it.note ? NOTE_LABEL : (formats().get(it.ext)?.label ?? it.ext))
}

const SORTS: { key: Sort; label: string }[] = [
  { key: 'moved', label: '更新順' },
  { key: 'name', label: '名前順' },
  { key: 'kind', label: '種類順' },
]

const WITHIN = [
  { days: 0, label: 'すべて' },
  { days: 1, label: '今日' },
  { days: 7, label: '7 日以内' },
  { days: 30, label: '30 日以内' },
]

type FacetKey = 'exts' | 'tags' | 'projects'

export interface ListToolsProps {
  /** 絞り込む前の項目。候補と件数はここから拾う */
  items: Item[]
  sort: Sort
  onSort: (sort: Sort) => void
  filter: ItemFilter
  onFilter: (filter: ItemFilter) => void
}

/** 絞り込みと並び替えのボタン。いまの場所の行があればそこに出し、なければその場に出す。 */
export function ListTools(props: ListToolsProps) {
  const barTools = useBarTools()
  const active = useTabActive()
  const bar = () => (active() ? barTools() : undefined)
  const [open, setOpen] = createSignal<'filter' | 'sort'>()
  let root: HTMLDivElement | undefined
  const close = () => setOpen(undefined)
  const onOutside = (e: PointerEvent) => {
    if (open() && !(e.target instanceof Node && root?.contains(e.target))) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open()) return
    e.stopPropagation()
    close()
  }
  onMount(() => {
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('keydown', onKey, true)
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('keydown', onKey, true)
  })

  const facets = createMemo(() => {
    const its = props.items
    const list: {
      key: FacetKey
      label: string
      min: number
      options: { value: string; label: string; n: number }[]
    }[] = [
      {
        key: 'exts',
        label: '形式',
        min: 2,
        options: counted(its.filter((i) => !i.note).map((i) => i.ext)).map(([v, n]) => ({
          value: v,
          label: `.${v}`,
          n,
        })),
      },
      {
        key: 'tags',
        label: 'タグ',
        min: 1,
        options: counted(its.flatMap((i) => [...new Set(i.tags)])).map(([v, n]) => ({ value: v, label: `# ${v}`, n })),
      },
      {
        key: 'projects',
        label: 'プロジェクト',
        min: 2,
        options: counted(its.map((i) => i.project ?? '')).map(([v, n]) => ({ value: v, label: v || '所属なし', n })),
      },
    ]
    return list.filter((f) => f.options.length >= f.min || props.filter[f.key].length)
  })
  const sortLabel = () => SORTS.find((s) => s.key === props.sort)?.label

  const tools = (
    <div class={styles.root} ref={root}>
      <BarButton
        label="絞り込み"
        aria-haspopup="dialog"
        aria-expanded={open() === 'filter'}
        aria-pressed={filtering(props.filter)}
        onClick={() => setOpen(open() === 'filter' ? undefined : 'filter')}
      >
        <Icon name="filter" size={15} />
      </BarButton>
      <BarButton
        label="並び替え"
        tip={`並び替え（${sortLabel()}）`}
        aria-haspopup="menu"
        aria-expanded={open() === 'sort'}
        onClick={() => setOpen(open() === 'sort' ? undefined : 'sort')}
      >
        <Icon name="sort" size={15} />
      </BarButton>
      <Show when={open() === 'sort'}>
        <div class={styles.drop}>
          <NavMenu
            focusFirst
            items={SORTS.map((s) => ({
              id: s.key,
              label: s.label,
              icon: s.key === props.sort ? ('check' as const) : undefined,
              current: s.key === props.sort,
            }))}
            onSelect={(id) => {
              const s = SORTS.find((x) => x.key === id)
              if (s) props.onSort(s.key)
              close()
            }}
            onClose={close}
          />
        </div>
      </Show>
      <Show when={open() === 'filter'}>
        <div class={styles.drop}>
          <div class={styles.panel} role="dialog" aria-label="絞り込み">
            <ScrollArea class={styles.scroll} viewClass={styles.body}>
              <input
                ref={(el) => queueMicrotask(() => el.focus())}
                class={styles.name}
                type="search"
                placeholder="名前で絞り込み"
                aria-label="名前"
                value={props.filter.name}
                onInput={(e) => props.onFilter({ ...props.filter, name: e.currentTarget.value })}
              />
              <For each={facets()}>
                {(f) => (
                  <div class={styles.facet}>
                    <b>{f.label}</b>
                    <div class={styles.chips}>
                      <For each={f.options}>
                        {(o) => (
                          <Chip
                            aria-pressed={props.filter[f.key].includes(o.value)}
                            onClick={() =>
                              props.onFilter({ ...props.filter, [f.key]: toggled(props.filter[f.key], o.value) })
                            }
                          >
                            {o.label}
                            <small>{o.n}</small>
                          </Chip>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
              <div class={styles.facet}>
                <b>更新</b>
                <div class={styles.chips}>
                  <For each={WITHIN}>
                    {(w) => (
                      <Chip
                        aria-pressed={props.filter.within === w.days}
                        onClick={() => props.onFilter({ ...props.filter, within: w.days })}
                      >
                        {w.label}
                      </Chip>
                    )}
                  </For>
                </div>
              </div>
            </ScrollArea>
            <footer>
              <Button
                size="sm"
                variant="ghost"
                disabled={!filtering(props.filter)}
                onClick={() => props.onFilter(NO_FILTER)}
              >
                条件をクリア
              </Button>
            </footer>
          </div>
        </div>
      </Show>
    </div>
  )

  return (
    <Show when={bar()} fallback={!barTools() && tools}>
      {(el) => <Portal mount={el()}>{tools}</Portal>}
    </Show>
  )
}
