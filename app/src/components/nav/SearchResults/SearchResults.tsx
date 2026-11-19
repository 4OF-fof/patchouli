import { For, type JSX, Show } from 'solid-js'
import type { IconName } from '../../base/Icon/Icon'
import { ResultHeading, ResultRow } from '../ResultRow/ResultRow'
import { type Item, type Library, type Project, thumbOf } from '../../../model/library'
import { type Candidate, foldMap } from '../../../model/search'
import { clock } from '../../media/PlayerBar/clock'
import styles from './SearchResults.module.css'

export type Row =
  | { type: 'cmd'; icon: IconName; label: string; key: string; run: () => void }
  | { type: 'proj'; p: Project }
  /** 打っている途中の「#」「@」「.」に合う、絞り込みの候補 */
  | { type: 'filter'; c: Candidate }
  /** why は、所属とタグのあとに足す当たりの説明 */
  | { type: 'item'; it: Item; why?: string }
  /** 何も入れていないときに出す、最近開いた項目 */
  | { type: 'recent'; it: Item }
  /** 内容での検索で当たった項目。at は当たった区間の始まり（秒） */
  | { type: 'hit'; it: Item; at?: number }
  | { type: 'create'; q: string }

/** terms は fold したもの。表記の違う元の文字列の、当たったところに印を付ける */
function marked(text: string, terms: string[]): JSX.Element {
  const m = foldMap(text)
  const on = Array.from({ length: text.length }, () => false)
  for (const t of terms.filter(Boolean)) {
    for (let i = m.text.indexOf(t); i >= 0; i = m.text.indexOf(t, i + t.length))
      on.fill(true, m.from[i], m.to[i + t.length - 1])
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

const SEC = {
  cmd: '操作',
  proj: 'プロジェクト',
  filter: '',
  item: '項目',
  recent: '最近開いた項目',
  hit: '内容で一致',
  create: '',
}
const FILTER = { tag: 'タグ', place: '場所', ext: '種類', not: '除外' }

const kindOf = (c: Candidate) =>
  c.filter.kind === 'place' ? (c.filter.place.group ? 'group' : 'project') : c.filter.kind

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
              {r.type !== 'create' && prev()?.type !== r.type && (
                <ResultHeading>{r.type === 'filter' ? FILTER[r.c.filter.kind] : SEC[r.type]}</ResultHeading>
              )}
              {r.type === 'filter' ? (
                <ResultRow
                  kind={kindOf(r.c)}
                  title={
                    r.c.filter.kind === 'not' ? `「${r.c.label}」を含む項目を除外` : marked(r.c.label, props.terms)
                  }
                  sub={r.c.sub ? `${r.c.sub} | ${r.c.n} 件` : `${r.c.n} 件`}
                  selected={sel()}
                  onClick={() => props.onRun(r)}
                />
              ) : r.type === 'cmd' ? (
                <ResultRow
                  kind="command"
                  icon={r.icon}
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
              ) : r.type === 'item' || r.type === 'recent' || r.type === 'hit' ? (
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
