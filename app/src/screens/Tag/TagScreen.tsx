import { For, type JSX, Show, createMemo, createSignal } from 'solid-js'
import { NoneText } from '../../components/NoneText/NoneText'
import { Chip } from '../../components/Chip/Chip'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/PinToggle/PinToggle'
import { ProgressBar } from '../../components/ProgressBar/ProgressBar'
import { type Library, type TagCoverPart, extOf, hasTag } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailPart } from '../Detail/DetailPart'
import { DetailScreen } from '../Detail/DetailScreen'
import shared from '../screen.module.css'
import styles from './TagScreen.module.css'

/** タグの表紙に足せる部品の名前と説明。 */
export const TAG_PARTS: Record<TagCoverPart['type'], { label: string; note: string }> = {
  desc: { label: '説明', note: '短い文' },
  kids: { label: '下の階層', note: '中のタグで絞り込む' },
  exts: { label: '拡張子ごとの数', note: 'jpg・png など' },
  together: { label: 'よく一緒に付くタグ', note: '多い順に 6 つ' },
}

/** 同じタグか、上や下の階層。よく一緒に付くタグには数えない。 */
const near = (tag: string, t: string) => t === tag || t.startsWith(tag + '/') || tag.startsWith(t + '/')

/** 値ごとの数を、多い順に。 */
const count = (xs: string[]) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
}

export interface TagScreenProps {
  lib: Library
  /** 例「写真」「写真/旅行」。 */
  tag: string
  /** ホームにピン留めしている。 */
  pinned?: boolean
  /** 下の階層で絞り込んでいる（例「写真/旅行」）。 */
  sub?: string
  /** 表紙を編集している。 */
  editing?: boolean
  /** 編集中に「＋ 部品を足す」の一覧を開いている。 */
  addOpen?: boolean
  backLabel?: string
  onBack?: () => void
  onOpenItem?: (id: string, list: string[]) => void
  onOpenTag?: (tag: string) => void
  /** 編集を終えたとき、名前が変わっていれば呼ぶ。付いている項目と下の階層の付け替えは呼んだ側でする。 */
  onRename?: (to: string) => void
}

/** 13 タグ。左に表紙の部品、右にすべての項目。 */
export function TagScreen(props: TagScreenProps) {
  const lib = () => props.lib
  const [pinned, setPinned] = createSignal(!!props.pinned)
  const [editing, setEditing] = createSignal(!!props.editing)
  const [addOpen, setAddOpen] = createSignal(!!props.addOpen)
  const [sub, setSub] = createSignal(props.sub ?? '')
  const [name, setName] = createSignal(props.tag)
  const [draft, setDraft] = createSignal(props.tag)
  const toggleEdit = () => {
    if (editing()) {
      const to = draft().trim().replace(/^#\s*/, '')
      if (to && to !== name()) {
        setName(to)
        props.onRename?.(to)
      }
      setDraft(name())
    }
    setEditing(!editing())
  }
  const cover = () => lib().tagCovers.get(props.tag) ?? []
  const all = createMemo(() => lib().items.filter((i) => hasTag(i, props.tag)))
  const shown = createMemo(() => (sub() ? all().filter((i) => hasTag(i, sub())) : all()))
  const kids = createMemo(() =>
    [...lib().tagGroups().keys()]
      .filter((t) => t.startsWith(props.tag + '/') && !t.slice(props.tag.length + 1).includes('/'))
      .map((t) => ({ tag: t, n: all().filter((i) => hasTag(i, t)).length }))
      .toSorted((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'ja')),
  )
  const exts = createMemo(() => count(shown().map(extOf)))
  const most = () => exts()[0]?.[1] ?? 1
  const together = createMemo(() =>
    count(shown().flatMap((i) => [...new Set(i.tags)].filter((t) => !near(props.tag, t)))).slice(0, 6),
  )
  const projectCount = () => new Set(all().flatMap((i) => i.folder ?? [])).size

  const body = (c: TagCoverPart): JSX.Element => {
    if (c.type === 'desc')
      return editing() ? (
        <textarea aria-label="説明" value={c.text} />
      ) : (
        <span>{c.text || <NoneText>（説明はまだありません）</NoneText>}</span>
      )
    if (c.type === 'kids')
      return (
        <Show when={kids().length} fallback={<NoneText>（下の階層のタグはありません）</NoneText>}>
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
        </Show>
      )
    if (c.type === 'exts')
      return (
        <div class={styles.bars}>
          <For each={exts()}>
            {([ext, n]) => (
              <div class={styles.row}>
                <span class={styles.ext}>.{ext}</span>
                <ProgressBar value={n / most()} />
                <span class={styles.n}>{n}</span>
              </div>
            )}
          </For>
        </div>
      )
    return (
      <Show when={together().length} fallback={<NoneText>（一緒に付くタグはありません）</NoneText>}>
        <div class={styles.chips}>
          <For each={together()}>
            {([t, n]) => (
              <Chip onClick={() => props.onOpenTag?.(t)}>
                # {t} {n}
              </Chip>
            )}
          </For>
        </div>
      </Show>
    )
  }

  return (
    <DetailScreen
      label="タグ"
      title={
        <Show when={editing()} fallback={<h1># {name()}</h1>}>
          <h1 class={styles.title}>
            <span>#</span>
            <input
              class={shared.nameEdit}
              type="text"
              aria-label="タグの名前"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && toggleEdit()}
            />
          </h1>
        </Show>
      }
      meta={
        editing()
          ? `名前を変えると、付いている ${all().length} 件と下の階層のタグも付け替えます`
          : `タグ · ${all().length} 件 · ${projectCount()} プロジェクト`
      }
      backLabel={props.backLabel}
      onBack={props.onBack}
      actions={
        <>
          <PinToggle where="ホームに" look="float" pressed={pinned()} onClick={() => setPinned(!pinned())} />
          <FloatingPill aria-pressed={editing()} onClick={toggleEdit}>
            {editing() ? '編集を終える' : '表紙を編集'}
          </FloatingPill>
          <FloatingPill icon aria-label="その他">
            ⋯
          </FloatingPill>
        </>
      }
      sideLabel="表紙"
      side={
        <>
          <For each={cover()}>
            {(c) => (
              <DetailPart label={TAG_PARTS[c.type].label} editing={editing()}>
                {body(c)}
              </DetailPart>
            )}
          </For>
          <Show when={editing()}>
            <AddPart parts={Object.values(TAG_PARTS)} open={addOpen()} onToggle={() => setAddOpen(!addOpen())} />
          </Show>
        </>
      }
      items={shown()}
      empty="このタグの付いたものはありません。"
      onOpenItem={props.onOpenItem}
    />
  )
}
