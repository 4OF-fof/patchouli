import { For, Show, createMemo, createSignal } from 'solid-js'
import { toggled } from '../../../model/library'
import { Icon } from '../../base/Icon/Icon'
import styles from './HeadingTree.module.css'

export interface HeadingTreeProps {
  /** いちばん上に置く、ノートの名前。 */
  title: string
  headings: { level: number; text: string }[]
  /** いま読んでいる見出しの番号。ノートの頭なら -1。 */
  current: number
  /** 見出しの番号を返す。ノートの名前なら -1。 */
  onSelect: (index: number) => void
}

/** ノートの見出しを、階層ごとに折りたためる木で並べる。 */
export function HeadingTree(props: HeadingTreeProps) {
  const [closed, setClosed] = createSignal<number[]>([])
  const top = () => Math.min(...props.headings.map((h) => h.level))
  const rows = createMemo(() => {
    const hs = props.headings
    const out: { index: number; depth: number; kids: boolean }[] = []
    // 折りたたんだ見出しの段。これより深い見出しは隠す
    let hideBelow = Infinity
    hs.forEach((h, index) => {
      if (h.level > hideBelow) return
      hideBelow = Infinity
      const kids = (hs[index + 1]?.level ?? 0) > h.level
      out.push({ index, depth: h.level - top(), kids })
      if (kids && closed().includes(index)) hideBelow = h.level
    })
    return out
  })
  // いまの見出しが折りたたまれていれば、折りたたんだ見出しを示す
  const shown = createMemo(() =>
    props.current < 0 ? -1 : (rows().findLast((r) => r.index <= props.current)?.index ?? -1),
  )
  return (
    <div class={styles.root}>
      <div class={styles.row}>
        <button
          type="button"
          class={styles.label}
          data-title
          data-current={shown() === -1}
          onClick={() => props.onSelect(-1)}
        >
          {props.title}
        </button>
      </div>
      <For each={rows()}>
        {(r) => {
          const open = () => !closed().includes(r.index)
          return (
            <div class={styles.row} data-heading style={{ '--depth': r.depth }}>
              <Show when={r.kids} fallback={<span class={styles.tw} />}>
                <button
                  type="button"
                  class={styles.tw}
                  aria-expanded={open()}
                  aria-label={open() ? '見出しを折りたたむ' : '見出しを展開'}
                  title={open() ? '見出しを折りたたむ' : '見出しを展開'}
                  onClick={() => setClosed(toggled(closed(), r.index))}
                >
                  <Icon name="chevron" class={styles.twi} />
                </button>
              </Show>
              <button
                type="button"
                class={styles.label}
                data-current={shown() === r.index}
                onClick={() => props.onSelect(r.index)}
              >
                {props.headings[r.index]?.text}
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
}
