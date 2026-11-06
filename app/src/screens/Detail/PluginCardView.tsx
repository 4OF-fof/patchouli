import { Show, createEffect, createMemo, on } from 'solid-js'
import type { CoverApi, CoverOn, Json } from '../../../plugins/sdk'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { PluginView } from '../../components/media/PluginView/PluginView'
import type { Item, Library, PluginCard } from '../../model/library'
import type { CoverInfo } from '../../plugins/types'
import { libraryItemOf } from '../Plugin/libraryItem'
import { DetailPart } from './DetailPart'
import { type CardHost, infoOf } from './pluginCards'

interface CardProps {
  lib: Library
  on: CoverOn
  /** タグの名前か、プロジェクトの名前。 */
  name: string
  items: Item[]
  editing?: boolean
  onValue: (value?: Json) => void
  onMove?: (by: number) => void
  onRemove?: () => void
}

export interface PluginCardViewProps extends CardProps {
  host?: CardHost
  /** 出すカードの ID。 */
  id: string
  cover: { id: string; type: string }[]
}

type Part = { id: string } & PluginCard

const same = (a?: Json, b?: Json) => JSON.stringify(a) === JSON.stringify(b)

function Card(props: CardProps & { host: CardHost; info: CoverInfo; part: Part }) {
  const pins = createMemo(() => new Set(props.lib.pins))
  const items = createMemo(() => props.items.map((it) => libraryItemOf(it, pins())))
  const changeSubs = new Set<() => void>()
  const editSubs = new Set<(editing: boolean) => void>()
  let value = props.part.value
  createEffect(
    on(
      items,
      () => {
        for (const fn of changeSubs) fn()
      },
      { defer: true },
    ),
  )
  // 自分で残した値が戻ってきたときは知らせない
  createEffect(
    on(
      () => props.part.value,
      (v) => {
        if (same(v, value)) return
        value = v
        for (const fn of changeSubs) fn()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => !!props.editing,
      (e) => {
        for (const fn of editSubs) fn(e)
      },
      { defer: true },
    ),
  )
  const api: CoverApi = {
    ...props.host.own(props.part.plugin),
    on: props.on,
    name: props.name,
    id: props.part.id,
    get value() {
      return value === undefined ? undefined : structuredClone(value)
    },
    setValue: (v) => {
      const next = v === undefined ? undefined : structuredClone(v)
      if (same(next, value)) return
      value = next
      props.onValue(next)
    },
    get editing() {
      return !!props.editing
    },
    onEditing: (fn) => {
      editSubs.add(fn)
      return () => editSubs.delete(fn)
    },
    items: () => items(),
    onChange: (fn) => {
      changeSubs.add(fn)
      return () => changeSubs.delete(fn)
    },
    open: (id, opts) => {
      if (!props.lib.byId.has(id)) throw new Error(`項目「${id}」が見つかりません`)
      props.host.open(id, opts)
    },
    openTag: (tag, opts) => props.host.openTag(tag, opts),
  }
  return (
    <DetailPart label={props.info.label} editing={props.editing} onMove={props.onMove} onRemove={props.onRemove}>
      {/* プラグインを読み直してスクリプトが変わったら、描き直す */}
      <Show when={props.host.url(props.info)} keyed fallback={<NoneText>この環境ではカードを描けません</NoneText>}>
        {(url) => <PluginView url={url} api={api} cover={props.info.card} />}
      </Show>
    </DetailPart>
  )
}

/** プラグインが足したカード。いまのプラグインがこの画面に出さないカードは、何も描かない。 */
export function PluginCardView(props: PluginCardViewProps) {
  const part = createMemo(() => props.cover.find((c): c is Part => c.id === props.id && c.type === 'plugin'))
  const info = createMemo(() => {
    const p = part()
    return p && infoOf(props.host, props.on, p)
  })
  return (
    <Show when={props.host}>
      {(host) => (
        <Show when={part()}>
          {(p) => <Show when={info()}>{(i) => <Card {...props} host={host()} info={i()} part={p()} />}</Show>}
        </Show>
      )}
    </Show>
  )
}
