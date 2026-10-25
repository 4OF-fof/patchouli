import { For, Show, createSignal } from 'solid-js'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { ItemCard } from '../../components/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/JustifiedRow/JustifiedRow'
import { PinToggle } from '../../components/PinToggle/PinToggle'
import { type CardSize, type Item, type Library, thumbOf } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailScreen } from '../Detail/DetailScreen'
import shared from '../screen.module.css'
import { CoverPartView, PARTS } from './CoverPart'
import styles from './ProjectScreen.module.css'

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
  const [pins, setPins] = createSignal(p()?.pins ?? [])
  const list = () => lib().inProject(props.name)
  const pinned = () => pins().flatMap((id) => lib().byId.get(id) ?? [])
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
    <Show when={p()}>
      {(pr) => (
        <DetailScreen
          label="プロジェクト"
          title={
            <Show when={editing()} fallback={<h1>{pr().name}</h1>}>
              <h1>
                <input
                  ref={(el) => props.editing && queueMicrotask(() => el.select())}
                  class={shared.nameEdit}
                  type="text"
                  aria-label="プロジェクトの名前"
                  value={pr().name}
                />
              </h1>
            </Show>
          }
          meta={`プロジェクト · ${list().length} 件 · 最後に扱った ${pr().touched}`}
          backLabel={props.backLabel}
          onBack={props.onBack}
          actions={
            <FloatingPill aria-pressed={editing()} onClick={() => setEditing(!editing())}>
              {editing() ? '編集を終える' : '表紙を編集'}
            </FloatingPill>
          }
          sideLabel="表紙"
          side={
            <>
              <For each={pr().cover}>{(c) => <CoverPartView lib={lib()} part={c} editing={editing()} />}</For>
              <Show when={editing()}>
                <AddPart parts={Object.values(PARTS)} open={addOpen()} onToggle={() => setAddOpen(!addOpen())} />
              </Show>
            </>
          }
          top={
            pinned().length ? (
              <>
                <div class={shared.head} data-first>
                  <h2>ピン留め</h2>
                  <span>{pinned().length} 件 · ピン留めした順</span>
                </div>
                <JustifiedRow height={196} gap={10}>
                  <For each={pinned()}>{(it) => card(it, 'M', pinned)}</For>
                </JustifiedRow>
              </>
            ) : undefined
          }
          items={list()}
          empty="まだ何も入っていません。ファイルをここに落とすと、このプロジェクトに入ります。"
          card={card}
          onOpenItem={props.onOpenItem}
        />
      )}
    </Show>
  )
}
