import { createMemo, createSignal } from 'solid-js'
import type { Item, Library } from '../../../model/library'
import { findItems, searchTerms } from '../../../model/search'
import { SearchPalette } from '../SearchPalette/SearchPalette'
import { type Row, SearchResults } from '../SearchResults/SearchResults'

export interface LinkPickerProps {
  lib: Library
  embed?: boolean
  folder?: string | null
  exclude?: string
  query?: string
  onPick: (it: Item) => void
  onCreate?: (name: string) => void
  onClose: () => void
}

export function LinkPicker(props: LinkPickerProps) {
  const [query, setQuery] = createSignal(props.query ?? '')
  const [idx, setIdx] = createSignal(0)
  const terms = () => searchTerms(query())
  const near = (it: Item) => (props.folder !== undefined && it.folder === props.folder ? 0 : 1)
  const rows = createMemo<Row[]>(() => {
    const ok = (it: Item) => it.id !== props.exclude && (!props.embed || !it.note)
    const ts = terms()
    const found = ts.length
      ? findItems(props.lib, ts).filter(({ it }) => ok(it))
      : props.lib.items
          .filter(ok)
          .toSorted((a, b) => a.moved - b.moved)
          .map((it) => ({ it, where: `最近 · ${it.folder ?? 'プロジェクトなし'}` }))
    const out: Row[] = found
      .toSorted((a, b) => near(a.it) - near(b.it))
      .slice(0, 8)
      .map((f) => ({ type: 'item', ...f }))
    const q = query().trim()
    if (q && props.onCreate && !props.embed) out.push({ type: 'create', q })
    return out
  })
  const run = (r: Row | undefined) => {
    if (r?.type === 'item') props.onPick(r.it)
    else if (r?.type === 'create') props.onCreate?.(r.q)
  }
  return (
    <SearchPalette
      mode={props.embed ? 'embed' : 'link'}
      query={query()}
      results={<SearchResults lib={props.lib} rows={rows()} selected={idx()} terms={terms()} onRun={run} />}
      onClose={props.onClose}
      onQueryInput={(q) => {
        setQuery(q)
        setIdx(0)
      }}
      onInputKeyDown={(e) => {
        if (e.isComposing) return
        if (e.key === 'Escape') {
          e.preventDefault()
          props.onClose()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setIdx(Math.max(0, Math.min(rows().length - 1, idx() + (e.key === 'ArrowDown' ? 1 : -1))))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const q = query().trim()
          if ((e.ctrlKey || e.metaKey) && q && !props.embed) props.onCreate?.(q)
          else run(rows()[idx()])
        }
      }}
    />
  )
}
