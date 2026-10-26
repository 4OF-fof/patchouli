import { For, type JSX, Show } from 'solid-js'
import { ResultHeading, ResultRow } from '../ResultRow/ResultRow'
import { type Item, type Library, type Project, thumbOf } from '../../../model/library'

/** 検索の結果の 1 行。 */
export type Row =
  | { type: 'cmd'; label: string; key: string; run: () => void }
  | { type: 'proj'; p: Project }
  | { type: 'item'; it: Item; where: string }
  | { type: 'create'; q: string }

/** 見つかった語を <mark> で囲む。 */
function marked(text: string, terms: string[]): JSX.Element {
  const low = text.toLowerCase()
  const on = Array.from({ length: text.length }, () => false)
  for (const t of terms.filter(Boolean)) {
    for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) on.fill(true, i, i + t.length)
  }
  const out: JSX.Element[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && on[j] === on[i]) j++
    out.push(on[i] ? <mark>{text.slice(i, j)}</mark> : text.slice(i, j))
    i = j
  }
  return out
}

const SEC = { cmd: '操作', proj: 'プロジェクト', item: '項目', create: '' }

export interface SearchResultsProps {
  lib: Library
  rows: Row[]
  /** 選んでいる行の番号。 */
  selected: number
  /** 見つかった所に印を付ける語。 */
  terms: string[]
  onRun: (r: Row) => void
}

/** 検索の結果。種類ごとに見出しを入れ、当たった語に印を付ける。 */
export function SearchResults(props: SearchResultsProps) {
  return (
    <Show when={props.rows.length} fallback={<ResultHeading>一致する項目がありません</ResultHeading>}>
      <For each={props.rows}>
        {(r, i) => {
          const prev = () => props.rows[i() - 1]
          const sel = () => i() === props.selected
          return (
            <>
              {r.type !== 'create' && prev()?.type !== r.type && <ResultHeading>{SEC[r.type]}</ResultHeading>}
              {r.type === 'cmd' ? (
                <ResultRow
                  kind="command"
                  title={marked(r.label, props.terms)}
                  kbd={r.key}
                  selected={sel()}
                  onClick={() => props.onRun(r)}
                />
              ) : r.type === 'proj' ? (
                <ResultRow
                  kind="project"
                  title={marked(r.p.name, props.terms)}
                  sub={`${props.lib.inProject(r.p.name).length} 件 · 最終更新 ${r.p.touched}`}
                  selected={sel()}
                  onClick={() => props.onRun(r)}
                />
              ) : r.type === 'item' ? (
                <ResultRow
                  kind={r.it.note ? 'note' : 'asset'}
                  title={marked(r.it.name, props.terms)}
                  sub={marked(r.where, props.terms)}
                  thumb={thumbOf(r.it)}
                  selected={sel()}
                  onClick={() => props.onRun(r)}
                />
              ) : (
                <ResultRow
                  kind="create"
                  title={`「${r.q}」というノートを作成`}
                  selected={sel()}
                  onClick={() => props.onRun(r)}
                />
              )}
            </>
          )
        }}
      </For>
    </Show>
  )
}
