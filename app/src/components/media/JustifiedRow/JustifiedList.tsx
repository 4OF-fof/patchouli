import { For, type JSX, batch, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { cardScale } from '../../../model/prefs'
import styles from './JustifiedList.module.css'

export interface JustifiedListProps<T> {
  /** スクロールする枠。見えている段を決めるのに使う */
  scroll: () => HTMLElement | undefined
  items: readonly T[]
  /** カードの縦横比。カードが --ar に渡す値と同じにする */
  ratio: (it: T) => number
  /** 段の高さの目安（JustifiedRow と同じ） */
  height: number
  gap?: number
  children: (it: T) => JSX.Element
}

interface Row<T> {
  items: T[]
  /** サムネイルの高さ。名前などの分は描いてから測る */
  h: number
  /** 最後の段は、幅いっぱいまで伸ばさない */
  last: boolean
}

/** 見えている所の上下に、この画面数分だけ描いておく */
const AHEAD = 1
/** 最後の段の残りを埋めるもの（JustifiedRow の ::after）の伸びる割合 */
const FILL = 999

/**
 * JustifiedRow と同じ並べ方で、見えている所の近くの段だけを描く。
 * 段の分け方は flex-wrap と同じ規則で求め、段の中の幅は CSS の flex に任せる。
 * 描いていない段の高さは、サムネイルの高さに、描いた段で測った名前などの高さを足して見積もる。
 */
export function JustifiedList<T>(props: JustifiedListProps<T>) {
  let root!: HTMLDivElement
  const gap = () => props.gap ?? 8
  const [width, setWidth] = createSignal(0)
  const [view, setView] = createSignal({ top: 0, bottom: 0 })

  const rows = createMemo((prev: Row<T>[] = []) => {
    const w = width()
    if (!w) return []
    const hh = props.height * cardScale()
    const g = gap()
    const reuse = new Map(prev.map((r) => [r.items[0], r]))
    const out: Row<T>[] = []
    let line: T[] = []
    let basis = 0
    let ars = 0
    const flush = (end: boolean) => {
      const n = line.length
      const free = w - basis - g * n
      const last = end && free >= 0
      const h = last ? hh + free / (ars + FILL) : (w - g * (n - 1)) / ars
      const old = reuse.get(line[0])
      const same =
        old && old.last === last && old.h === h && old.items.length === n && old.items.every((x, i) => x === line[i])
      out.push(same ? old : { items: line, h, last })
      line = []
      basis = 0
      ars = 0
    }
    for (const it of props.items) {
      const ar = props.ratio(it)
      if (line.length && basis + ar * hh + g * line.length > w) flush(false)
      line.push(it)
      basis += ar * hh
      ars += ar
    }
    if (line.length) flush(true)
    return out
  })

  // 測った段の高さ。段は作り直すと別のものになるので、古いものは勝手に消える
  const sizes = new WeakMap<Row<T>, number>()
  const [measured, setMeasured] = createSignal(0)
  const [extra, setExtra] = createSignal(0)
  const heightOf = (r: Row<T>) => sizes.get(r) ?? r.h + extra()
  const offsets = createMemo(() => {
    void measured()
    const out = [0]
    for (const r of rows()) out.push((out.at(-1) ?? 0) + heightOf(r) + gap())
    return out
  })
  const total = () => Math.max(0, (offsets().at(-1) ?? 0) - gap())

  const range = createMemo(
    () => {
      const o = offsets()
      const { top, bottom } = view()
      let a = 0
      while (a < rows().length && (o[a + 1] ?? 0) <= top) a++
      let b = a
      while (b < rows().length && (o[b] ?? 0) < bottom) b++
      return [a, b] as const
    },
    undefined,
    { equals: (x, y) => x[0] === y[0] && x[1] === y[1] },
  )
  const shown = createMemo(() => rows().slice(range()[0], range()[1]))

  // ResizeObserver の中で大きさを変えると、そのフレームで測り切れずにエラーになるので、描き直しは次のフレームに回す
  let remeasure = 0
  let resized = 0
  let nextExtra = 0
  const elRows = new Map<Element, Row<T>>()
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const r = elRows.get(e.target)
      if (!r) continue
      const h = e.borderBoxSize[0]?.blockSize ?? e.target.getBoundingClientRect().height
      if (sizes.get(r) === h) continue
      sizes.set(r, h)
      nextExtra = Math.max(0, h - r.h)
      remeasure ||= requestAnimationFrame(() => {
        remeasure = 0
        batch(() => {
          setExtra(nextExtra)
          setMeasured(measured() + 1)
        })
      })
    }
  })
  const watch = (el: HTMLDivElement, r: Row<T>) => {
    elRows.set(el, r)
    ro.observe(el)
    onCleanup(() => {
      ro.unobserve(el)
      elRows.delete(el)
    })
  }

  const update = () => {
    const s = props.scroll()
    if (!s) return
    setWidth(root.clientWidth)
    const top = s.getBoundingClientRect().top - root.getBoundingClientRect().top
    const h = s.clientHeight
    setView({ top: top - h * AHEAD, bottom: top + h * (1 + AHEAD) })
  }
  onMount(() => {
    update()
    const s = props.scroll()
    if (!s) return
    // 上にあるものの大きさが変わると、スクロールしなくても位置がずれるので、中身の大きさの変化でも確かめる
    const size = new ResizeObserver(() => {
      resized ||= requestAnimationFrame(() => {
        resized = 0
        update()
      })
    })
    size.observe(root)
    size.observe(s)
    if (s.firstElementChild) size.observe(s.firstElementChild)
    s.addEventListener('scroll', update, { passive: true })
    onCleanup(() => {
      size.disconnect()
      s.removeEventListener('scroll', update)
    })
  })
  onCleanup(() => {
    ro.disconnect()
    cancelAnimationFrame(remeasure)
    cancelAnimationFrame(resized)
  })

  return (
    <div
      ref={root}
      class={styles.root}
      style={{
        height: `${total()}px`,
        '--hh': `calc(${props.height}px * var(--card-scale, 1))`,
        '--gap': `${gap()}px`,
      }}
    >
      <div class={styles.rows} style={{ top: `${offsets()[range()[0]] ?? 0}px` }}>
        <For each={shown()}>
          {(r) => (
            <div ref={(el) => watch(el, r)} class={styles.row} data-last={r.last || undefined}>
              <For each={r.items}>{(it) => props.children(it)}</For>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
