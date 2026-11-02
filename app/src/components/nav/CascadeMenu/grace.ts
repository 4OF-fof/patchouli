export type Point = { x: number; y: number }

/** メニューを開いた先の向き */
export type Side = 'right' | 'left' | 'down'

/** 乗せてから開くまで */
export const OPEN_DELAY = 100
/** 猶予の領域が効いている時間 */
export const GRACE = 300

const BLEED = 5

export const inside = (p: Point, poly: Point[]) => {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/**
 * 開いた項目から出た位置と、開いたメニューの四隅を結ぶ領域。
 * この中にいるあいだは、メニューへ向かっているとみなし、ほかの項目に反応しない。
 */
export const graceArea = (exit: Point, r: DOMRect, side: Side): Point[] => {
  if (side === 'down')
    return [
      { x: exit.x, y: exit.y - BLEED },
      { x: r.left, y: r.top },
      { x: r.left, y: r.bottom },
      { x: r.right, y: r.bottom },
      { x: r.right, y: r.top },
    ]
  const right = side === 'right'
  const near = right ? r.left : r.right
  const far = right ? r.right : r.left
  return [
    { x: exit.x + (right ? -BLEED : BLEED), y: exit.y },
    { x: near, y: r.top },
    { x: far, y: r.top },
    { x: far, y: r.bottom },
    { x: near, y: r.bottom },
  ]
}
