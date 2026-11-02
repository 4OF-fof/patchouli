import { For, createMemo } from 'solid-js'
import styles from './HeadingTree.module.css'

export interface HeadingTreeProps {
  headings: { level: number; text: string }[]
  /** いま読んでいる見出しの番号。ノートの頭なら -1。 */
  current: number
  onSelect: (index: number) => void
}

/** ノートの見出しを、階層ごとに木で並べる。 */
export function HeadingTree(props: HeadingTreeProps) {
  const top = () => Math.min(...props.headings.map((h) => h.level))
  const rows = createMemo(() => {
    const out = props.headings.map((h, index) => ({ index, depth: h.level - top(), last: true, rails: [] as number[] }))
    // 同じ親の下に続きがあるかで、線を下まで延ばすかを決める
    const lastAt: boolean[] = []
    out.forEach((r, i) => {
      const next = out.slice(i + 1).find((x) => x.depth <= r.depth)
      r.last = next?.depth !== r.depth
      r.rails = lastAt.slice(0, r.depth).flatMap((last, k) => (!last ? [k] : []))
      lastAt.length = r.depth
      lastAt[r.depth] = r.last
    })
    return out
  })
  return (
    <div class={styles.root}>
      <For each={rows()}>
        {(r) => (
          <div class={styles.row} style={{ '--depth': r.depth }}>
            <For each={r.rails.filter((k) => k > 0)}>{(k) => <span class={styles.rail} style={{ '--col': k }} />}</For>
            {r.depth > 0 && <span class={styles.elbow} data-last={r.last} />}
            <button
              type="button"
              class={styles.label}
              data-current={props.current === r.index}
              onClick={() => props.onSelect(r.index)}
            >
              {props.headings[r.index]?.text}
            </button>
          </div>
        )}
      </For>
    </div>
  )
}
