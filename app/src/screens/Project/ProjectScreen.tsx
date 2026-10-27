import { For, Show, createSignal } from 'solid-js'
import { Button } from '../../components/controls/Button/Button'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import type { Library } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailScreen } from '../Detail/DetailScreen'
import shared from '../screen.module.css'
import { CoverPartView, PARTS } from './CoverPart'

export interface ProjectScreenProps {
  lib: Library
  name: string
  pinned?: boolean
  editing?: boolean
  addOpen?: boolean
  onTogglePin?: (id: string) => void
  onToggleProjectPin?: () => void
  onOpenItem?: (id: string, list: string[]) => void
}

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
              <Button pressed={editing()} onClick={() => setEditing(!editing())}>
                {editing() ? '編集を完了' : '概要を編集'}
              </Button>
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
