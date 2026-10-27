import { type Item, type Library, plainText } from './library'

export const searchTerms = (q: string) => q.trim().toLowerCase().replace(/#\s*/g, '').split(/\s+/).filter(Boolean)

export function findItems(lib: Library, terms: string[]): { it: Item; where: string }[] {
  const found: { it: Item; sc: number; where: string }[] = []
  for (const it of lib.items) {
    const text = it.note ? plainText(it.blocks ?? []) : ''
    let sc = 0
    const where: string[] = []
    const ok = terms.every((t) => {
      if (it.name.toLowerCase().includes(t)) sc += 3
      else if (it.tags.some((x) => x.toLowerCase().includes(t))) {
        sc += 2
        where.push(`タグ # ${it.tags.find((x) => x.toLowerCase().includes(t))}`)
      } else if (it.folder?.toLowerCase().includes(t)) {
        sc += 1
        where.push(`プロジェクト ${it.folder}`)
      } else if (text.toLowerCase().includes(t)) {
        sc += 1
        const p = text.toLowerCase().indexOf(t)
        where.push(`本文 …${text.slice(Math.max(0, p - 8), p + 16)}…`)
      } else return false
      return true
    })
    if (ok) found.push({ it, sc, where: where.join(' · ') || (it.folder ?? 'プロジェクトなし') })
  }
  return found.toSorted((a, b) => b.sc - a.sc || a.it.moved - b.it.moved).map(({ it, where }) => ({ it, where }))
}
