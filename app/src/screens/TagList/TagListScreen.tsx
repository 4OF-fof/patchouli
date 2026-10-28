import { For, Show, createMemo, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Icon } from '../../components/base/Icon/Icon'
import { Tabs } from '../../components/controls/Tabs/Tabs'
import { ThumbStrip } from '../../components/media/ThumbStrip/ThumbStrip'
import { type Item, type Library, coverOrder, toggled } from '../../model/library'
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
  expanded?: string[]
  sort?: Sort
  onOpenTag?: (tag: string) => void
}

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
              aria-label={isOpen() ? 'サブタグを折りたたむ' : 'サブタグを展開'}
              data-tip={isOpen() ? 'サブタグを折りたたむ' : 'サブタグを展開'}
              onClick={() => setOpen(toggled(open(), r.tag))}
            >
              <Icon name="chevron" class={styles.twi} />
            </button>
          </Show>
          <button type="button" class={styles.link} data-tip="タグを開く" onClick={() => props.onOpenTag?.(r.tag)}>
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
            <ThumbStrip class={styles.strip} items={r.items.toSorted(coverOrder(lib())).slice(0, 8)} />
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
        <div class={shared.page}>
          <header class={shared.mast}>
            <h1>タグ</h1>
            <span class={shared.meta}>
              {flat().size} 件 · {sort() === 'name' ? '名前順' : '件数順'}
            </span>
            <span class={shared.end}>
              <Tabs
                label="並び順"
                value={sort()}
                onChange={setSort}
                items={[
                  { key: 'name', label: '名前順' },
                  { key: 'count', label: '件数順' },
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
