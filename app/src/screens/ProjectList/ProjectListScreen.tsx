import { For, Show, createSignal } from 'solid-js'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { Mosaic } from '../../components/Mosaic/Mosaic'
import { PinToggle } from '../../components/PinToggle/PinToggle'
import { type Library, type Project, coverOf, dueLabel, nextDue } from '../../model/library'
import shared from '../screen.module.css'
import styles from './ProjectListScreen.module.css'

export interface ProjectListScreenProps {
  lib: Library
  pinned?: string[]
  onOpenProject?: (name: string) => void
  /** 空のプロジェクトを作る。 */
  onCreate?: () => void
}

/** 11 プロジェクト一覧。ピン留め、最近のもの、しばらく触っていないもの。 */
export function ProjectListScreen(props: ProjectListScreenProps) {
  const lib = () => props.lib
  const [pins, setPins] = createSignal(props.pinned ?? [])
  const recency = (p: Project) => {
    if (p.touched.startsWith('今日')) return 0
    const l = lib().inProject(p.name)
    return l.length ? Math.min(...l.map((i) => i.moved)) : 999
  }
  const sorted = () => lib().projects.toSorted((a, b) => recency(a) - recency(b))
  const togglePin = (n: string) => setPins(pins().includes(n) ? pins().filter((x) => x !== n) : [...pins(), n])

  const card = (p: Project, big: boolean) => {
    const list = () => lib().inProject(p.name)
    const desc = p.cover.find((c) => c.type === 'desc')
    const todo = p.cover.find((c) => c.type === 'todo')
    const due = nextDue(p)
    const dl = due ? dueLabel(lib(), due) : null
    const done = todo?.type === 'todo' ? todo.items.filter((x) => x.done).length : 0
    return (
      <div class={styles.wrap}>
        <button type="button" class={styles.card} data-big={big} onClick={() => props.onOpenProject?.(p.name)}>
          <Mosaic tiles={coverOf(lib(), p, 5).map((i) => ({ hue: i.hue, sat: i.sat }))} />
          <span class={styles.nm}>{p.name}</span>
          {big && <span class={styles.ds}>{desc?.type === 'desc' ? desc.text : ' '}</span>}
          <span class={styles.pm}>
            <span>{list().length} 件</span>
            {big && <b>今週 +{list().filter((i) => i.moved <= 7).length}</b>}
            {big && dl && (
              <span>
                {dl.date} · {dl.left}
              </span>
            )}
            <span class={styles.r}>{p.touched}</span>
          </span>
          {big && todo?.type === 'todo' && todo.items.length > 0 && (
            <span class={styles.pm}>
              <span>やること</span>
              <span class={styles.bar}>
                <span style={{ width: `${(done / todo.items.length) * 100}%` }} />
              </span>
            </span>
          )}
        </button>
        <PinToggle class={styles.pin} pressed={pins().includes(p.name)} onClick={() => togglePin(p.name)} />
      </div>
    )
  }

  return (
    <section class={shared.screen} aria-label="プロジェクト一覧">
      <div class={shared.scroll}>
        <div class={`${shared.page} ${shared.top}`}>
          <header class={shared.mast}>
            <h1>プロジェクト</h1>
            <span class={shared.meta}>{lib().projects.length} 件 · 最近開いた順</span>
            <span class={shared.end}>
              <FloatingPill onClick={() => props.onCreate?.()}>＋ 新しいプロジェクト</FloatingPill>
            </span>
          </header>
          <Show when={pins().length}>
            <div class={shared.head}>
              <h2>ピン留め</h2>
              <span>{pins().length} 件 · ピン留めした順</span>
            </div>
            <div class={styles.grid} data-pinned>
              <For each={pins().flatMap((n) => lib().projectBy.get(n) ?? [])}>{(p) => card(p, true)}</For>
            </div>
          </Show>
          <div class={shared.head}>
            <h2>すべてのプロジェクト</h2>
            <span>{lib().projects.length} 件 · 最近開いた順</span>
          </div>
          <div class={styles.grid}>
            <For each={sorted().filter((p) => recency(p) <= 30)}>{(p) => card(p, true)}</For>
          </div>
          <Show when={sorted().some((p) => recency(p) > 30)}>
            <div class={styles.quiet}>
              <For each={sorted().filter((p) => recency(p) > 30)}>{(p) => card(p, false)}</For>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}
