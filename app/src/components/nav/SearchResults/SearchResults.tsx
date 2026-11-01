import { For, type JSX, Show } from 'solid-js'
import { ResultHeading, ResultRow } from '../ResultRow/ResultRow'
import { type Item, type Library, type Project, thumbOf } from '../../../model/library'
import { clock } from '../../media/PlayerBar/clock'
import styles from './SearchResults.module.css'

export type Row =
  | { type: 'cmd'; label: string; key: string; run: () => void }
  | { type: 'proj'; p: Project }
  /** why は、所属とタグのあとに足す当たりの説明 */
  | { type: 'item'; it: Item; why?: string }
  /** 内容での検索で当たった項目。at は当たった区間の始まり（秒） */
  | { type: 'hit'; it: Item; at?: number }
  | { type: 'create'; q: string }

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

function Where(props: { lib: Library; it: Item; terms: string[]; why?: string }) {
  return (
    <>
      {marked(props.lib.placeName(props.it) ?? '所属なし', props.terms)}
      <For each={props.it.tags}>{(t) => <span class={styles.tag}>{marked(`# ${t}`, props.terms)}</span>}</For>
      {props.why && <> | {marked(props.why, props.terms)}</>}
    </>
  )
}

const SEC = { cmd: '操作', proj: 'プロジェクト', item: '項目', hit: '内容で一致', create: '' }

export interface SearchResultsProps {
  lib: Library
  rows: Row[]
  selected: number
  terms: string[]
  onRun: (r: Row) => void
}

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
                  sub={`${props.lib.inProject(r.p.name).length} 件 | 最終更新 ${r.p.touched}`}
                  selected={sel()}
                  onClick={() => props.onRun(r)}
                />
              ) : r.type === 'item' || r.type === 'hit' ? (
                <ResultRow
                  kind={r.it.note ? 'note' : 'asset'}
                  title={marked(r.it.name, props.terms)}
                  sub={
                    <Where lib={props.lib} it={r.it} terms={props.terms} why={r.type === 'item' ? r.why : undefined} />
                  }
                  aside={r.type === 'hit' && r.at !== undefined ? `${clock(r.at)} から` : undefined}
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
