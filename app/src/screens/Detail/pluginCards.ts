import type { CoverOn, Json, OpenOptions, OwnApi } from '../../../plugins/sdk'
import { type PluginCard, newCardId } from '../../model/library'
import type { CoverInfo, UiRef } from '../../plugins/types'
import { moved } from './parts'

/** 概要にプラグインのカードを出すための窓口。 */
export interface CardHost {
  cards: CoverInfo[]
  /** カードを描くスクリプトの URL。描けない環境では undefined。 */
  url: (ui: UiRef) => string | undefined
  own: (plugin: string) => OwnApi
  open: (id: string, opts?: OpenOptions) => void
  openTag: (tag: string, opts?: OpenOptions) => void
}

/** 「セクションを追加」で、プラグインのカードを本体のカードと見分ける値。本体のカードの種類には / がない。 */
const keyOf = (c: { plugin: string; card: string }) => `${c.plugin}/${c.card}`

/** on の画面に、いまのプラグインが出すカード。 */
export const infoOf = (host: CardHost | undefined, on: CoverOn, c: { type: string }) =>
  c.type === 'plugin' && 'plugin' in c && 'card' in c
    ? host?.cards.find((x) => x.on.includes(on) && x.plugin === c.plugin && x.card === c.card)
    : undefined

/** 概要に出すカード。出せないプラグインのカードは、保存のために並びに残して隠す。 */
export const shownCards = <C extends { type: string }>(host: CardHost | undefined, on: CoverOn, cover: C[]) =>
  cover.filter((c) => c.type !== 'plugin' || infoOf(host, on, c))

/** 概要に足せるプラグインのカード。 */
export const addableCards = (host: CardHost | undefined, on: CoverOn, cover: { type: string }[]) =>
  (host?.cards ?? [])
    .filter((x) => x.on.includes(on))
    .filter((x) => x.multiple || !cover.some((c) => infoOf(host, on, c) === x))
    .map((x) => ({ type: keyOf(x), label: x.label, note: x.note }))

/** 「セクションを追加」で選んだプラグインのカード。本体のカードなら undefined。 */
export function newPluginCard(host: CardHost | undefined, type: string): ({ id: string } & PluginCard) | undefined {
  const x = host?.cards.find((c) => keyOf(c) === type)
  return x && { id: newCardId(), type: 'plugin', plugin: x.plugin, card: x.card }
}

/** id のプラグインのカードに、value を残す。value がなければ消す。 */
export const withValue = <C extends { id: string; type: string }>(cover: C[], id: string, value?: Json): C[] =>
  cover.map((c) => (c.id === id && c.type === 'plugin' ? { ...c, value } : c))

/** 出しているカードの i 枚目を by 枚動かす。隠したカードは、前後のカードとの並びを保つ。 */
export function movedShown<T>(list: T[], shown: (x: T) => boolean, i: number, by: number): T[] {
  const at = list.flatMap((x, k) => (shown(x) ? [k] : []))
  const from = at[i]
  const to = at[i + by]
  return from === undefined || to === undefined ? list : moved(list, from, to - from)
}
