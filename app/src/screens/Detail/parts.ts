/** multiple は、同じ種類のカードを 1 つの概要にいくつも置けるか。 */
export interface PartKind {
  label: string
  note: string
  multiple: boolean
}

/** 概要に足せるカードの種類。同じ種類を 1 つしか置けないものは、すでにあれば外す。 */
export const addable = <T extends string>(parts: Record<T, PartKind>, types: readonly T[], cover: { type: T }[]) =>
  types
    .filter((type) => parts[type].multiple || !cover.some((c) => c.type === type))
    .map((type) => ({ type, label: parts[type].label, note: parts[type].note }))

export function moved<T>(list: T[], i: number, by: -1 | 1): T[] {
  const next = [...list]
  const [x] = next.splice(i, 1)
  if (x !== undefined) next.splice(i + by, 0, x)
  return next
}
