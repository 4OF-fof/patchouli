import { Index, Show, createEffect, createSignal, on } from 'solid-js'
import { Icon } from '../../components/base/Icon/Icon'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { Button } from '../../components/controls/Button/Button'
import { IconButton } from '../../components/controls/IconButton/IconButton'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { ConfirmDialog } from '../../components/dialog/ConfirmDialog/ConfirmDialog'
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
  onOpenGroup?: (id: string) => void
  onSaveCover?: (cover: CoverPart[]) => void
  onRename?: (to: string) => void
  onDelete?: () => void
}

export function ProjectScreen(props: ProjectScreenProps) {
  const lib = () => props.lib
  const p = () => lib().projectBy.get(props.name)
  const [pinned, setPinned] = createSignal(!!props.pinned)
  createEffect(
    on(
      () => props.pinned,
      (v) => setPinned(!!v),
      { defer: true },
    ),
  )
  const [editing, setEditing] = createSignal(!!props.editing)
  const [addOpen, setAddOpen] = createSignal(!!props.addOpen)
  const [draft, setDraft] = createSignal(props.name)
  const [flat, setFlat] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const here = () => ({ project: props.name, group: null })
  const list = () => (flat() ? lib().inProject(props.name) : lib().inPlace(here()))
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
          meta={`${lib().inProject(props.name).length} 件 | 最終更新 ${pr().touched}`}
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
              <Show when={editing() && props.onDelete}>
                <IconButton label="プロジェクトを削除" onClick={() => setDeleting(true)}>
                  <Icon name="trash" />
                </IconButton>
              </Show>
              <Show when={deleting()}>
                <ConfirmDialog
                  label="削除の確認"
                  title={`プロジェクト「${pr().name}」を削除しますか？`}
                  onClose={() => setDeleting(false)}
                  onEnter={() => props.onDelete?.()}
                  footer={
                    <>
                      <Button variant="ghost" onClick={() => setDeleting(false)}>
                        キャンセル <Kbd>Esc</Kbd>
                      </Button>
                      <Button variant="danger" onClick={() => props.onDelete?.()}>
                        削除 <Kbd>Enter</Kbd>
                      </Button>
                    </>
                  }
                >
                  <p>
                    中の項目（{lib().inProject(pr().name).length}{' '}
                    件）とフォルダは所属なしに移動し、概要はごみ箱に移動します。
                  </p>
                </ConfirmDialog>
              </Show>
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
                    onMove={(by) => save(moved(cover(), i, by))}
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
          lib={lib()}
          groups={flat() ? [] : lib().groupsIn(here())}
          flat={flat()}
          onFlat={setFlat}
          onOpenGroup={props.onOpenGroup}
          empty="項目がありません。ファイルをここにドロップすると、このプロジェクトに追加されます。"
          pins={lib().pins}
          pinFrom={lib().inProject(props.name)}
          onTogglePin={props.onTogglePin}
          onOpenItem={props.onOpenItem}
        />
      )}
    </Show>
  )
}
