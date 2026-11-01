import { type Item, type Library, newerFirst, plainText } from './library'

export const searchTerms = (q: string) => q.trim().toLowerCase().replace(/#\s*/g, '').split(/\s+/).filter(Boolean)

/** why は、所属とタグからは分からない当たり（別名・本文） */
export function findItems(lib: Library, terms: string[]): { it: Item; why?: string }[] {
  const found: { it: Item; sc: number; why?: string }[] = []
  for (const it of lib.items) {
    const text = it.note ? plainText(it.body ?? '') : ''
    let sc = 0
    const why: string[] = []
    const ok = terms.every((t) => {
      const alias = it.aliases?.find((x) => x.toLowerCase().includes(t))
      if (it.name.toLowerCase().includes(t)) sc += 3
      else if (alias) {
        sc += 3
        why.push(`別名 ${alias}`)
      } else if (it.tags.some((x) => x.toLowerCase().includes(t))) sc += 2
      else if (lib.placeName(it)?.toLowerCase().includes(t)) sc += 1
      else if (text.toLowerCase().includes(t)) {
        sc += 1
        const p = text.toLowerCase().indexOf(t)
        why.push(`本文 …${text.slice(Math.max(0, p - 8), p + 16)}…`)
      } else return false
      return true
    })
    if (ok) found.push({ it, sc, why: why.join(' | ') || undefined })
  }
  return found.toSorted((a, b) => b.sc - a.sc || newerFirst(a.it, b.it)).map(({ it, why }) => ({ it, why }))
}
