import { For, Show, createMemo, createSignal } from 'solid-js'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/PinToggle/PinToggle'
import { Tabs } from '../../components/Tabs/Tabs'
import { Thumb } from '../../components/Thumb/Thumb'
import { type Item, type Library, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './TagListScreen.module.css'

type Sort = 'name' | 'count'
interface Row {
  tag: string
  items: Item[]
  kids: Row[]
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export interface TagListScreenProps {
  lib: Library
  /** 紙面にピン留めしているタグ。 */
  pinned?: string[]
  /** 下の階層を開いているタグ。 */
  expanded?: string[]
  sort?: Sort
  backLabel?: string
  onBack?: () => void
  onOpenTag?: (tag: string) => void
}

/** 12 タグ一覧。「写真/旅行」は「写真」の下に入り、親は下の分も数える。 */
export function TagListScreen(props: TagListScreenProps) {
  const lib = () => props.lib
  const [sort, setSort] = createSignal<Sort>(props.sort ?? 'count')
  const [open, setOpen] = createSignal(props.expanded ?? [])
  const [pins, setPins] = createSignal(props.pinned ?? [])
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
              onClick={() => setOpen(toggle(open(), r.tag))}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M6 3.5 10.5 8 6 12.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </Show>
          <button type="button" class={styles.tn} onClick={() => props.onOpenTag?.(r.tag)}>
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
          </button>
          <div class={styles.strip}>
            <For each={r.items.toSorted((a, b) => a.moved - b.moved).slice(0, 8)}>
              {(i) => <Thumb {...thumbOf(i, 'X')} />}
            </For>
          </div>
          <PinToggle where="紙面に" pressed={pins().includes(r.tag)} onClick={() => setPins(toggle(pins(), r.tag))} />
          <button type="button" class={styles.all} onClick={() => props.onOpenTag?.(r.tag)}>
            すべて ›
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
      <div class={shared.scroll}>
        <div class={shared.page}>
          <header class={shared.mast}>
            <FloatingPill class={shared.back} onClick={() => props.onBack?.()}>
              ‹ {props.backLabel ?? '紙面'}
            </FloatingPill>
            <h1>タグ</h1>
            <span class={shared.meta}>
              {flat().size} 件 · {sort() === 'name' ? '五十音順' : '件数の多い順'}
            </span>
            <span class={shared.right}>
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
      </div>
    </section>
  )
}
