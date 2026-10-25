import { For, Show, createMemo, createSignal } from 'solid-js'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { ItemCard } from '../../components/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/JustifiedRow/JustifiedRow'
import { PinToggle } from '../../components/PinToggle/PinToggle'
import { Tabs } from '../../components/Tabs/Tabs'
import { type CardSize, type Item, type Library, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import { AddPart, CoverPartView } from './CoverPart'
import styles from './ProjectScreen.module.css'

type Sort = 'moved' | 'name' | 'kind'
const KIND_ORDER = { note: 0, image: 1, video: 2, audio: 3 }

export interface ProjectScreenProps {
  lib: Library
  name: string
  /** 表紙を編集している。 */
  editing?: boolean
  /** 編集中に「＋ 部品を足す」の一覧を開いている。 */
  addOpen?: boolean
  /** 戻る先の名前。 */
  backLabel?: string
  onBack?: () => void
  onOpenItem?: (id: string, list: string[]) => void
}

/** 10 プロジェクト。表紙の部品、ピン留め、すべての項目。 */
export function ProjectScreen(props: ProjectScreenProps) {
  const lib = () => props.lib
  const p = () => lib().projectBy.get(props.name)
  const [editing, setEditing] = createSignal(!!props.editing)
  const [addOpen, setAddOpen] = createSignal(!!props.addOpen)
  const [sort, setSort] = createSignal<Sort>('moved')
  const [pins, setPins] = createSignal(p()?.pins ?? [])
  const list = () => lib().inProject(props.name)
  const pinned = () => pins().flatMap((id) => lib().byId.get(id) ?? [])
  const all = createMemo(() =>
    list().toSorted(
      sort() === 'name'
        ? (a, b) => a.name.localeCompare(b.name, 'ja')
        : sort() === 'kind'
          ? (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.moved - b.moved
          : (a, b) => a.moved - b.moved,
    ),
  )
  const togglePin = (id: string) => setPins(pins().includes(id) ? pins().filter((x) => x !== id) : [...pins(), id])
  const card = (it: Item, size: CardSize, from: () => Item[]) => (
    <div class={styles.pc} style={{ '--ar': it.ratio }}>
      <ItemCard
        {...thumbOf(it, size)}
        name={it.name}
        ratio={it.ratio}
        onClick={() =>
          props.onOpenItem?.(
            it.id,
            from().map((x) => x.id),
          )
        }
      />
      <PinToggle class={styles.pin} look="float" pressed={pins().includes(it.id)} onClick={() => togglePin(it.id)} />
    </div>
  )
  return (
    <section class={shared.screen} aria-label="プロジェクト">
      <div class={shared.scroll}>
        <Show when={p()}>
          {(pr) => (
            <div class={shared.page}>
              <header class={shared.mast}>
                <FloatingPill class={shared.back} onClick={() => props.onBack?.()}>
                  ‹ {props.backLabel ?? 'ホーム'}
                </FloatingPill>
                <Show when={editing()} fallback={<h1>{pr().name}</h1>}>
                  <h1>
                    <input
                      ref={(el) => props.editing && queueMicrotask(() => el.select())}
                      class={styles.name}
                      type="text"
                      aria-label="プロジェクトの名前"
                      value={pr().name}
                    />
                  </h1>
                </Show>
                <span class={shared.meta}>
                  プロジェクト · {list().length} 件 · 最後に扱った {pr().touched}
                </span>
                <span class={shared.right}>
                  <FloatingPill aria-pressed={editing()} onClick={() => setEditing(!editing())}>
                    {editing() ? '編集を終える' : '表紙を編集'}
                  </FloatingPill>
                </span>
              </header>
              <div class={styles.body}>
                <div class={styles.cover} aria-label="表紙">
                  <For each={pr().cover}>{(c) => <CoverPartView lib={lib()} part={c} editing={editing()} />}</For>
                  <Show when={editing()}>
                    <AddPart open={addOpen()} onToggle={() => setAddOpen(!addOpen())} />
                  </Show>
                </div>
                <div>
                  <div class={shared.head} data-first>
                    <h2>ピン留め</h2>
                    <span>{pinned().length} 件 · ピン留めした順</span>
                  </div>
                  <Show
                    when={pinned().length}
                    fallback={<div class={shared.empty}>カードの右上のピンで、ここに留められます。</div>}
                  >
                    <JustifiedRow height={196} gap={10}>
                      <For each={pinned()}>{(it) => card(it, 'M', pinned)}</For>
                    </JustifiedRow>
                  </Show>
                  <div class={shared.head}>
                    <h2>すべて</h2>
                    <span>{list().length} 件</span>
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
                  <Show
                    when={all().length}
                    fallback={
                      <div class={shared.empty}>
                        まだ何も入っていません。ファイルをここに落とすと、このプロジェクトに入ります。
                      </div>
                    }
                  >
                    <JustifiedRow height={104}>
                      <For each={all()}>{(it) => card(it, 'S', all)}</For>
                    </JustifiedRow>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    </section>
  )
}
