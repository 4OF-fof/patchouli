import { For, Show, createSignal } from 'solid-js'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import type { Library } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailScreen } from '../Detail/DetailScreen'
import shared from '../screen.module.css'
import { CoverPartView, PARTS } from './CoverPart'

export interface ProjectScreenProps {
  lib: Library
  name: string
  /** ホームにピン留めしている。 */
  pinned?: boolean
  /** 表紙を編集している。 */
  editing?: boolean
  /** 編集中に「＋ 部品を足す」の一覧を開いている。 */
  addOpen?: boolean
  /** 戻る先の名前。 */
  backLabel?: string
  onBack?: () => void
  onTogglePin?: (id: string) => void
  /** このプロジェクトのホームへのピン留めを切り替える。 */
  onToggleProjectPin?: () => void
  onOpenItem?: (id: string, list: string[]) => void
}

/** 10 プロジェクト。表紙の部品、ピン留め、すべての項目。 */
export function ProjectScreen(props: ProjectScreenProps) {
  const lib = () => props.lib
  const p = () => lib().projectBy.get(props.name)
  const [pinned, setPinned] = createSignal(!!props.pinned)
  const [editing, setEditing] = createSignal(!!props.editing)
  const [addOpen, setAddOpen] = createSignal(!!props.addOpen)
  const list = () => lib().inProject(props.name)
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
                  aria-label="プロジェクト名"
                  value={pr().name}
                />
              </h1>
            </Show>
          }
          meta={`プロジェクト · ${list().length} 件 · 最終更新 ${pr().touched}`}
          backLabel={props.backLabel}
          onBack={props.onBack}
          actions={
            <>
              <PinToggle
                where="ホームに"
                pressed={pinned()}
                onClick={() => {
                  setPinned(!pinned())
                  props.onToggleProjectPin?.()
                }}
              />
              <FloatingPill aria-pressed={editing()} onClick={() => setEditing(!editing())}>
                {editing() ? '編集を完了' : '概要を編集'}
              </FloatingPill>
            </>
          }
          sideLabel="概要"
          side={
            <>
              <For each={pr().cover}>{(c) => <CoverPartView lib={lib()} part={c} editing={editing()} />}</For>
              <Show when={editing()}>
                <AddPart parts={Object.values(PARTS)} open={addOpen()} onToggle={() => setAddOpen(!addOpen())} />
              </Show>
            </>
          }
          items={list()}
          empty="項目がありません。ファイルをここにドロップすると、このプロジェクトに追加されます。"
          pins={lib().pins}
          onTogglePin={props.onTogglePin}
          onOpenItem={props.onOpenItem}
        />
      )}
    </Show>
  )
}
