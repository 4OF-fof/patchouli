import { For, Show, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Icon } from '../../components/base/Icon/Icon'
import { Button } from '../../components/controls/Button/Button'
import { Tabs } from '../../components/controls/Tabs/Tabs'
import { Mosaic } from '../../components/media/Mosaic/Mosaic'
import { middleClick } from '../../components/nav/TabPane/newTab'
import { ProgressBar } from '../../components/base/ProgressBar/ProgressBar'
import { type Library, type Project, coverOf, coverTile, dueLabel, nextDue } from '../../model/library'
import shared from '../screen.module.css'
import styles from './ProjectListScreen.module.css'

type Sort = 'moved' | 'name' | 'count'

const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, 'ja')

export interface ProjectListScreenProps {
  lib: Library
  pinned?: string[]
  sort?: Sort
  onOpenProject?: (name: string) => void
  onCreate?: () => void
}

export function ProjectListScreen(props: ProjectListScreenProps) {
  const lib = () => props.lib
  const pins = () => props.pinned ?? []
  const [sort, setSort] = createSignal<Sort>(props.sort ?? 'moved')
  const recency = (p: Project) => {
    if (p.touched.startsWith('今日')) return 0
    const l = lib().inProject(p.name)
    return l.length ? Math.min(...l.map((i) => i.moved)) : 999
  }
  const sorted = () => {
    const count = (p: Project) => lib().inProject(p.name).length
    return lib().projects.toSorted(
      sort() === 'name'
        ? byName
        : sort() === 'count'
          ? (a, b) => count(b) - count(a) || byName(a, b)
          : (a, b) => recency(a) - recency(b) || byName(a, b),
    )
  }

  const card = (p: Project) => {
    const list = () => lib().inProject(p.name)
    const desc = p.cover.find((c) => c.type === 'desc')
    const todo = p.cover.find((c) => c.type === 'todo')
    const due = nextDue(p)
    const dl = due ? dueLabel(lib(), due) : null
    const done = todo?.type === 'todo' ? todo.items.filter((x) => x.done).length : 0
    return (
      <button
        type="button"
        class={styles.card}
        onClick={() => props.onOpenProject?.(p.name)}
        {...middleClick(() => props.onOpenProject?.(p.name))}
      >
        <Mosaic tiles={coverOf(lib(), p, 5).map(coverTile)} />
        <span class={styles.nm}>{p.name}</span>
        <span class={styles.ds}>{desc?.type === 'desc' ? desc.text : ' '}</span>
        <span class={styles.pm}>
          <span>{list().length} 件</span>
          <b>今週 +{list().filter((i) => i.moved <= 7).length}</b>
          {dl && (
            <span>
              {dl.date} | {dl.left}
            </span>
          )}
          <span class={styles.r}>{p.touched}</span>
        </span>
        {todo?.type === 'todo' && todo.items.length > 0 && (
          <span class={styles.pm}>
            <span>タスク</span>
            <ProgressBar class={styles.bar} value={done / todo.items.length} />
          </span>
        )}
      </button>
    )
  }

  return (
    <section class={shared.screen} aria-label="プロジェクト一覧">
      <ScrollArea class={shared.scroll}>
        <div class={shared.page}>
          <header class={shared.mast}>
            <h1>プロジェクト</h1>
            <span class={shared.meta}>{lib().projects.length} 件</span>
            <span class={shared.end}>
              <Button onClick={() => props.onCreate?.()}>
                <Icon name="plus" size={14} withText />
                新しいプロジェクト
              </Button>
            </span>
          </header>
          <Show when={pins().length}>
            <div class={shared.head}>
              <h2>ピン留め</h2>
              <span>{pins().length} 件</span>
            </div>
            <div class={styles.grid} data-pinned>
              <For each={pins().flatMap((n) => lib().projectBy.get(n) ?? [])}>{(p) => card(p)}</For>
            </div>
          </Show>
          <div class={shared.head}>
            <h2>すべてのプロジェクト</h2>
            <span>{lib().projects.length} 件</span>
            <Tabs
              label="並び順"
              value={sort()}
              onChange={setSort}
              items={[
                { key: 'moved', label: '更新順' },
                { key: 'name', label: '名前順' },
                { key: 'count', label: '件数順' },
              ]}
            />
          </div>
          <div class={styles.grid}>
            <For each={sorted()}>{(p) => card(p)}</For>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
