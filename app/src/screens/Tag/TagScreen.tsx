import { For, Show, createMemo, createSignal } from 'solid-js'
import { Chip } from '../../components/Chip/Chip'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/PinToggle/PinToggle'
import { type Library, hasTag } from '../../model/library'
import { DetailPart } from '../Detail/DetailPart'
import { DetailScreen } from '../Detail/DetailScreen'
import styles from './TagScreen.module.css'

/** 同じタグか、上や下の階層。よく一緒に付くタグには数えない。 */
const near = (tag: string, t: string) => t === tag || t.startsWith(tag + '/') || tag.startsWith(t + '/')

export interface TagScreenProps {
  lib: Library
  /** 例「写真」「写真/旅行」。 */
  tag: string
  /** ホームにピン留めしている。 */
  pinned?: boolean
  /** 下の階層で絞り込んでいる（例「写真/旅行」）。 */
  sub?: string
  backLabel?: string
  onBack?: () => void
  onOpenItem?: (id: string, list: string[]) => void
  onOpenTag?: (tag: string) => void
  onOpenProject?: (name: string) => void
}

/** 13 タグ。左に下の階層・プロジェクトごとの数・よく一緒に付くタグ、右にすべての項目。 */
export function TagScreen(props: TagScreenProps) {
  const lib = () => props.lib
  const [pinned, setPinned] = createSignal(!!props.pinned)
  const [sub, setSub] = createSignal(props.sub ?? '')
  const all = createMemo(() => lib().items.filter((i) => hasTag(i, props.tag)))
  const shown = createMemo(() => (sub() ? all().filter((i) => hasTag(i, sub())) : all()))
  const kids = createMemo(() =>
    [...lib().tagGroups().keys()]
      .filter((t) => t.startsWith(props.tag + '/') && !t.slice(props.tag.length + 1).includes('/'))
      .map((t) => ({ tag: t, n: all().filter((i) => hasTag(i, t)).length }))
      .toSorted((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'ja')),
  )
  const projects = createMemo(() => {
    const m = new Map<string | null, number>()
    for (const i of shown()) m.set(i.folder, (m.get(i.folder) ?? 0) + 1)
    return [...m].toSorted((a, b) => b[1] - a[1] || (a[0] ?? '').localeCompare(b[0] ?? '', 'ja'))
  })
  const most = () => projects()[0]?.[1] ?? 1
  const together = createMemo(() => {
    const m = new Map<string, number>()
    for (const i of shown()) for (const t of new Set(i.tags)) if (!near(props.tag, t)) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, 6)
  })
  const projectCount = () => new Set(all().flatMap((i) => i.folder ?? [])).size

  return (
    <DetailScreen
      label="タグ"
      title={<h1># {props.tag}</h1>}
      meta={`タグ · ${all().length} 件 · ${projectCount()} プロジェクト`}
      backLabel={props.backLabel}
      onBack={props.onBack}
      actions={
        <>
          <PinToggle where="ホームに" pressed={pinned()} onClick={() => setPinned(!pinned())} />
          <FloatingPill class={styles.more} aria-label="その他">
            ⋯
          </FloatingPill>
        </>
      }
      sideLabel="内訳"
      side={
        <>
          <Show when={kids().length}>
            <DetailPart label="下の階層">
              <div class={styles.chips}>
                <Chip aria-pressed={!sub()} onClick={() => setSub('')}>
                  すべて {all().length}
                </Chip>
                <For each={kids()}>
                  {(k) => (
                    <Chip aria-pressed={sub() === k.tag} onClick={() => setSub(k.tag)}>
                      {k.tag.slice(props.tag.length + 1)} {k.n}
                    </Chip>
                  )}
                </For>
              </div>
            </DetailPart>
          </Show>
          <DetailPart label="プロジェクト">
            <div class={styles.bars}>
              <For each={projects()}>
                {([name, n]) => (
                  <button
                    type="button"
                    class={styles.pr}
                    disabled={!name}
                    onClick={() => name && props.onOpenProject?.(name)}
                  >
                    <span class={styles.pn}>{name ?? 'プロジェクトなし'}</span>
                    <span class={styles.track}>
                      <span style={{ width: `${(n / most()) * 100}%` }} />
                    </span>
                    <span class={styles.pc}>{n}</span>
                  </button>
                )}
              </For>
            </div>
          </DetailPart>
          <Show when={together().length}>
            <DetailPart label="よく一緒に付くタグ">
              <div class={styles.chips}>
                <For each={together()}>
                  {([t, n]) => (
                    <Chip onClick={() => props.onOpenTag?.(t)}>
                      # {t} {n}
                    </Chip>
                  )}
                </For>
              </div>
            </DetailPart>
          </Show>
        </>
      }
      items={shown()}
      empty="このタグの付いたものはありません。"
      onOpenItem={props.onOpenItem}
    />
  )
}
