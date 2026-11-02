import { type Item, type Library, type Place, hasTag, newerFirst, plainText } from './library'

// 濁点などの結合文字と半角の濁点・半濁点は、前の文字とまとめてそろえる
const UNIT = /.[\p{M}ﾞﾟ]*/gsu

/** 検索のために表記をそろえる。NFKC にし、小文字にし、カタカナをひらがなにする */
export const fold = (s: string) =>
  s
    .replace(UNIT, (u) => u.normalize('NFKC').toLowerCase())
    .replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

/** fold した文字列と、その 1 文字ずつが元の文字列のどこからどこまでにあたるか */
export function foldMap(s: string): { text: string; from: number[]; to: number[] } {
  let text = ''
  const from: number[] = []
  const to: number[] = []
  for (const m of s.matchAll(UNIT)) {
    const f = fold(m[0])
    for (let k = 0; k < f.length; k++) {
      from.push(m.index)
      to.push(m.index + m[0].length)
    }
    text += f
  }
  return { text, from, to }
}

const SEP = /[\s_\-./・()[\]（）「」『』、。,:：|]/

/** t が f のどこにあるかで決める一致の強さ。完全 3・前方 2・語の先頭 1.5・部分 1・なし 0 */
export function strength(f: string, t: string): number {
  if (!t) return 1
  let i = f.indexOf(t)
  if (i < 0) return 0
  if (f.length === t.length) return 3
  if (i === 0) return 2
  for (; i >= 0; i = f.indexOf(t, i + 1)) if (SEP.test(f[i - 1] ?? '')) return 1.5
  return 1
}

export type FilterKind = 'tag' | 'place' | 'ext'

/** 確定した絞り込み。place は、プロジェクトかグループ */
export type Filter = { kind: 'tag'; tag: string } | { kind: 'place'; place: Place } | { kind: 'ext'; ext: string }

export interface Chip {
  filter: Filter
  label: string
}

const KIND: Record<string, FilterKind> = { '#': 'tag', '@': 'place', '.': 'ext' }

export interface Query {
  /** fold した言葉 */
  terms: string[]
  /** 書いたままの「#」「@」「.」の語。fold して、部分一致で絞る */
  loose: { kind: FilterKind; text: string }[]
  /** 打っている途中の「#」「@」「.」の語。入力の最後にあって、後ろに空白がないもの */
  typing?: { kind: FilterKind; text: string }
}

export function parseQuery(q: string): Query {
  const words = fold(q).split(/\s+/).filter(Boolean)
  const out: Query = { terms: [], loose: [] }
  for (const w of words) {
    const kind = KIND[w[0] ?? '']
    if (kind) out.loose.push({ kind, text: w.slice(1) })
    else out.terms.push(w)
  }
  const last = out.loose.at(-1)
  if (last && words.length && KIND[words.at(-1)?.[0] ?? ''] && !/\s$/.test(q)) out.typing = last
  return out
}

/** 結果の中で印を付ける言葉 */
export const markTerms = (q: Query) => [...q.terms, ...q.loose.map((l) => l.text)].filter(Boolean)

interface Doc {
  name: string
  aliases: string[]
  tags: string[]
  memo: string
  body: string
  ext: string
  label: string
  placeRaw: string | null
  place: string
}

const docs = new WeakMap<Item, Doc>()

function docOf(lib: Library, it: Item): Doc {
  const placeRaw = lib.placeName(it)
  const d = docs.get(it)
  if (d && d.placeRaw === placeRaw) return d
  const made: Doc = d
    ? { ...d, placeRaw, place: fold(placeRaw ?? '') }
    : {
        name: fold(it.name),
        aliases: (it.aliases ?? []).map(fold),
        tags: it.tags.map(fold),
        memo: fold(it.memo),
        body: it.note ? fold(plainText(it.body ?? '')) : '',
        ext: fold(it.ext),
        label: fold(lib.formatLabel(it)),
        placeRaw,
        place: fold(placeRaw ?? ''),
      }
  docs.set(it, made)
  return made
}

const W = { name: 6, alias: 6, tag: 4, memo: 3, place: 2, body: 1, ext: 1 }
type Field = keyof typeof W

const best = (fs: string[], t: string) => Math.max(0, ...fs.map((f) => strength(f, t)))

/** 元の文字列で、fold した t のまわりを切り出す */
function snippet(text: string, t: string) {
  const m = foldMap(text)
  const i = m.text.indexOf(t)
  if (i < 0) return text.slice(0, 24)
  const p = m.from[i] ?? 0
  return `…${text.slice(Math.max(0, p - 8), (m.to[i + t.length - 1] ?? p) + 16)}…`
}

function fits(d: Doc, l: Query['loose'][number]) {
  if (!l.text) return true
  if (l.kind === 'tag') return d.tags.some((t) => t.includes(l.text))
  if (l.kind === 'place') return d.place.includes(l.text)
  return d.ext.startsWith(l.text) || d.label.includes(l.text)
}

/** why は、所属とタグからは分からない当たり（別名・メモ・本文） */
export function findItems(lib: Library, q: Query, chips: Filter[] = []): { it: Item; why?: string }[] {
  const inGroups = new Map(
    chips.flatMap((f) =>
      f.kind === 'place' && f.place.group ? [[f.place.group, new Set(lib.inGroup(f.place.group))]] : [],
    ),
  )
  const matches = (it: Item, f: Filter) =>
    f.kind === 'tag'
      ? hasTag(it, f.tag)
      : f.kind === 'ext'
        ? it.ext === f.ext
        : f.place.group
          ? !!inGroups.get(f.place.group)?.has(it)
          : it.project === f.place.project
  const found: { it: Item; sc: number; why?: string }[] = []
  for (const it of lib.items) {
    if (!chips.every((f) => matches(it, f))) continue
    const d = docOf(lib, it)
    if (!q.loose.every((l) => fits(d, l))) continue
    let sc = 0
    const why: string[] = []
    const ok = q.terms.every((t) => {
      const by: [Field, number][] = [
        ['name', strength(d.name, t)],
        ['alias', best(d.aliases, t)],
        ['tag', best(d.tags, t)],
        ['memo', strength(d.memo, t)],
        ['place', strength(d.place, t)],
        ['body', d.body.includes(t) ? 1 : 0],
        ['ext', strength(d.ext, t)],
      ]
      const [field, s] = by.reduce((a, b) => (W[b[0]] * b[1] > W[a[0]] * a[1] ? b : a))
      if (!s) return false
      sc += W[field] * s
      if (field === 'alias') {
        const a = it.aliases?.find((x) => fold(x).includes(t))
        if (a) why.push(`別名 ${a}`)
      } else if (field === 'memo') why.push(`メモ ${snippet(it.memo, t)}`)
      else if (field === 'body') why.push(`本文 ${snippet(plainText(it.body ?? ''), t)}`)
      return true
    })
    if (ok) found.push({ it, sc, why: why.join(' | ') || undefined })
  }
  return found.toSorted((a, b) => b.sc - a.sc || newerFirst(a.it, b.it)).map(({ it, why }) => ({ it, why }))
}

export interface Candidate {
  filter: Filter
  label: string
  /** 補足（種類の名前など） */
  sub?: string
  n: number
}

const CANDIDATES = 6

const keyOf = (f: Filter) =>
  f.kind === 'tag' ? `#${f.tag}` : f.kind === 'ext' ? `.${f.ext}` : `@${f.place.project}\n${f.place.group}`

/** 候補を確定したときの絞り込み */
export const chipOf = (c: Candidate): Chip => ({
  filter: c.filter,
  label: c.filter.kind === 'tag' ? `# ${c.label}` : c.filter.kind === 'place' ? `@ ${c.label}` : c.label,
})

/** 打っている途中の「#」「@」「.」の語に合う、タグ・場所・種類 */
export function candidates(lib: Library, typing: NonNullable<Query['typing']>, chips: Filter[]): Candidate[] {
  const all: Candidate[] = []
  if (typing.kind === 'tag')
    for (const [tag, items] of lib.tagGroups()) all.push({ filter: { kind: 'tag', tag }, label: tag, n: items.length })
  else if (typing.kind === 'place') {
    for (const p of lib.projects)
      all.push({
        filter: { kind: 'place', place: { project: p.name, group: null } },
        label: p.name,
        n: lib.inProject(p.name).length,
      })
    for (const g of lib.groups) {
      const place = { project: g.project, group: g.id }
      all.push({ filter: { kind: 'place', place }, label: lib.placeName(place) ?? g.name, n: lib.inGroup(g.id).length })
    }
  } else {
    const byExt = new Map<string, Item[]>()
    for (const it of lib.items) byExt.set(it.ext, [...(byExt.get(it.ext) ?? []), it])
    for (const [ext, items] of byExt)
      all.push({ filter: { kind: 'ext', ext }, label: `.${ext}`, sub: lib.formatLabel(items[0]), n: items.length })
  }
  return all
    .filter((c) => !chips.some((f) => keyOf(f) === keyOf(c.filter)))
    .map((c) => ({
      c,
      s: Math.max(strength(fold(c.label.replace(/^\./, '')), typing.text), strength(fold(c.sub ?? ''), typing.text)),
    }))
    .filter((x) => x.s > 0)
    .toSorted((a, b) => b.s - a.s || b.c.n - a.c.n)
    .slice(0, CANDIDATES)
    .map((x) => x.c)
}

/** 操作の名前に q が合うか。続いていれば 2 以上、飛び飛びでも順に入っていれば 1、合わなければ 0 */
export function commandScore(label: string, q: string): number {
  const t = fold(q).replace(/\s+/g, '')
  if (!t) return 1
  const f = fold(label)
  const s = strength(f, t)
  if (s) return 1 + s
  let i = 0
  for (const c of f) if (c === t[i]) i++
  return i >= t.length ? 1 : 0
}

/** 開いた記録の中で、ライブラリに残っている項目 */
export const recentItems = (lib: Library, ids: string[]) => ids.flatMap((id) => lib.byId.get(id) ?? [])
