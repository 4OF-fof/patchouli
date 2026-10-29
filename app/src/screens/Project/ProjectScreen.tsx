import { Index, Show, createSignal } from 'solid-js'
import { Button } from '../../components/controls/Button/Button'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import type { CoverPart, Library } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailScreen } from '../Detail/DetailScreen'
import { addable, moved } from '../Detail/parts'
import shared from '../screen.module.css'
import { CoverPartView, PARTS, PART_TYPES, emptyPart } from './CoverPart'

export interface ProjectScreenProps {
  lib: Library
  name: string
  pinned?: boolean
  editing?: boolean
  addOpen?: boolean
  onTogglePin?: (id: string) => void
  onToggleProjectPin?: () => void
  onOpenItem?: (id: string, list: string[]) => void
  onSaveCover?: (cover: CoverPart[]) => void
  onRename?: (to: string) => void
}

export function ProjectScreen(props: ProjectScreenProps) {
  const lib = () => props.lib
  const p = () => lib().projectBy.get(props.name)
  const [pinned, setPinned] = createSignal(!!props.pinned)
  const [editing, setEditing] = createSignal(!!props.editing)
  const [addOpen, setAddOpen] = createSignal(!!props.addOpen)
  const [draft, setDraft] = createSignal(props.name)
  const list = () => lib().inProject(props.name)
  const cover = () => p()?.cover ?? []
  const save = (next: CoverPart[]) => props.onSaveCover?.(next)
  const toggleEdit = () => {
    if (editing()) {
      const to = draft().trim()
      if (to && to !== props.name) props.onRename?.(to)
    } else setDraft(props.name)
    setEditing(!editing())
    setAddOpen(false)
  }
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
                  value={draft()}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && toggleEdit()}
                />
              </h1>
            </Show>
          }
          meta={`プロジェクト · ${list().length} 件 · 最終更新 ${pr().touched}`}
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
              <Button pressed={editing()} onClick={toggleEdit}>
                {editing() ? '編集を完了' : '概要を編集'}
              </Button>
            </>
          }
          sideLabel="概要"
          side={
            <>
              <Index each={cover()}>
                {(c, i) => (
                  <CoverPartView
                    lib={lib()}
                    part={c()}
                    editing={editing()}
                    onChange={(x) => save(cover().map((y, k) => (k === i ? x : y)))}
                    onUp={i > 0 ? () => save(moved(cover(), i, -1)) : undefined}
                    onDown={i < cover().length - 1 ? () => save(moved(cover(), i, 1)) : undefined}
                    onRemove={() => save(cover().filter((_, k) => k !== i))}
                  />
                )}
              </Index>
              <Show when={editing()}>
                <AddPart
                  parts={addable(PARTS, PART_TYPES, cover())}
                  open={addOpen()}
                  onToggle={() => setAddOpen(!addOpen())}
                  onPick={(type) => {
                    save([...cover(), emptyPart(type)])
                    setAddOpen(false)
                  }}
                />
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
