import { For, Show, createMemo, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Icon } from '../../components/base/Icon/Icon'
import { Tabs } from '../../components/controls/Tabs/Tabs'
import { ThumbStrip } from '../../components/media/ThumbStrip/ThumbStrip'
import { type Item, type Library, toggled } from '../../model/library'
import shared from '../screen.module.css'
import styles from './TagListScreen.module.css'

type Sort = 'name' | 'count'
interface Row {
  tag: string
  items: Item[]
  kids: Row[]
}

export interface TagListScreenProps {
  lib: Library
  /** 下の階層を開いているタグ。 */
  expanded?: string[]
  sort?: Sort
  onOpenTag?: (tag: string) => void
}

/** 12 タグ一覧。「写真/旅行」は「写真」の下に入り、親は下の分も数える。 */
export function TagListScreen(props: TagListScreenProps) {
  const lib = () => props.lib
  const [sort, setSort] = createSignal<Sort>(props.sort ?? 'count')
  const [open, setOpen] = createSignal(props.expanded ?? [])
  const flat = createMemo(() => lib().tagGroups())
  const rows = createMemo(() => {
    const sorter =
      sort() === 'name'
        ? (a: Row, b: Row) => a.tag.localeCompare(b.tag, 'ja')
        : (a: Row, b: Row) => b.items.length - a.items.length || a.tag.localeCompare(b.tag, 'ja')
    const top = new Map<string, { set: Set<Item>; kids: Row[] }>()
    for (const [t, list] of flat()) {
      const k = t.split('/')[0] ?? t
      const g = top.get(k) ?? { set: new Set<Item>(), kids: [] }
      top.set(k, g)
      for (const i of list) g.set.add(i)
      if (t !== k) g.kids.push({ tag: t, items: list, kids: [] })
    }
    return [...top].map(([tag, g]) => ({ tag, items: [...g.set], kids: g.kids.toSorted(sorter) })).toSorted(sorter)
  })

  const row = (r: Row, sub: boolean) => {
    const projects = new Set(r.items.flatMap((i) => i.folder ?? [])).size
    const isOpen = () => open().includes(r.tag)
    const [head, ...rest] = r.tag.split('/')
    return (
      <>
        <div class={styles.row} data-sub={sub}>
          <Show when={!sub && r.kids.length} fallback={<span class={styles.tw} />}>
            <button
              type="button"
              class={styles.tw}
              aria-expanded={isOpen()}
              aria-label={isOpen() ? '下の階層を閉じる' : '下の階層を開く'}
              title={isOpen() ? '下の階層を閉じる' : '下の階層を開く'}
              onClick={() => setOpen(toggled(open(), r.tag))}
            >
              <Icon name="chevron" class={styles.twi} />
            </button>
          </Show>
          <button type="button" class={styles.link} title="タグを開く" onClick={() => props.onOpenTag?.(r.tag)}>
            <span class={styles.tn}>
              <b>
                {sub ? (
                  <>
                    <i># {head}/</i>
                    {rest.join('/')}
                  </>
                ) : (
                  `# ${r.tag}`
                )}
              </b>
              <span>
                {r.items.length} 件 · {projects} プロジェクト
              </span>
            </span>
            <ThumbStrip class={styles.strip} items={r.items.toSorted((a, b) => a.moved - b.moved).slice(0, 8)} />
            <Icon name="chevron" class={styles.go} />
          </button>
        </div>
        <Show when={!sub && isOpen()}>
          <For each={r.kids}>{(k) => row(k, true)}</For>
        </Show>
      </>
    )
  }

  return (
    <section class={shared.screen} aria-label="タグ一覧">
      <ScrollArea class={shared.scroll}>
        <div class={`${shared.page} ${shared.top}`}>
          <header class={shared.mast}>
            <h1>タグ</h1>
            <span class={shared.meta}>
              {flat().size} 件 · {sort() === 'name' ? '五十音順' : '件数の多い順'}
            </span>
            <span class={shared.end}>
              <Tabs
                label="並べ方"
                value={sort()}
                onChange={setSort}
                items={[
                  { key: 'name', label: '五十音' },
                  { key: 'count', label: '件数' },
                ]}
              />
            </span>
          </header>
          <div>
            <For each={rows()}>{(r) => row(r, false)}</For>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
