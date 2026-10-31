import { Show, createSignal } from 'solid-js'
import type { Library } from '../../model/library'
import { DetailScreen } from '../Detail/DetailScreen'

export interface GroupScreenProps {
  lib: Library
  id: string
  pins?: string[]
  onTogglePin?: (id: string) => void
  onOpenItem?: (id: string, list: string[]) => void
  onOpenGroup?: (id: string) => void
}

export function GroupScreen(props: GroupScreenProps) {
  const lib = () => props.lib
  const [flat, setFlat] = createSignal(false)
  const g = () => lib().groupBy.get(props.id)
  const here = () => ({ project: g()?.project ?? null, group: props.id })
  const list = () => (flat() ? lib().inGroup(props.id) : lib().inPlace(here()))
  return (
    <Show when={g()}>
      {(gr) => (
        <DetailScreen
          label="グループ"
          title={<h1>{gr().name}</h1>}
          meta={`${lib().inGroup(props.id).length} 件 / 最終更新 ${gr().touched}`}
          items={list()}
          lib={lib()}
          groups={flat() ? [] : lib().groupsIn(here())}
          flat={flat()}
          onFlat={setFlat}
          onOpenGroup={props.onOpenGroup}
          empty="項目がありません。ファイルをここにドロップすると、このグループに追加されます。"
          pins={props.pins ?? lib().pins}
          pinFrom={lib().inGroup(props.id)}
          onTogglePin={props.onTogglePin}
          onOpenItem={props.onOpenItem}
        />
      )}
    </Show>
  )
}
