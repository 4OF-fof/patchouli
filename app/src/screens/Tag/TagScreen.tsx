import { For, type JSX, Show, createMemo, createSignal } from 'solid-js'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { Chip } from '../../components/controls/Chip/Chip'
import { Icon } from '../../components/base/Icon/Icon'
import { Button } from '../../components/controls/Button/Button'
import { IconButton } from '../../components/controls/IconButton/IconButton'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { ProgressBar } from '../../components/base/ProgressBar/ProgressBar'
import { type Library, type TagCoverPart, hasTag } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailPart } from '../Detail/DetailPart'
import { DetailScreen } from '../Detail/DetailScreen'
import shared from '../screen.module.css'
import styles from './TagScreen.module.css'

export const TAG_PARTS: Record<TagCoverPart['type'], { label: string; note: string }> = {
  desc: { label: '説明', note: 'テキスト' },
  kids: { label: 'サブタグ', note: '階層下のタグで絞り込み' },
  exts: { label: 'ファイル形式', note: '拡張子ごとの件数' },
  together: { label: '関連タグ', note: 'よく併用されるタグ' },
}

const near = (tag: string, t: string) => t === tag || t.startsWith(tag + '/') || tag.startsWith(t + '/')

const count = (xs: string[]) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
}

export interface TagScreenProps {
  lib: Library
  tag: string
  pinned?: boolean
  sub?: string
  editing?: boolean
  addOpen?: boolean
  onOpenItem?: (id: string, list: string[]) => void
  onOpenTag?: (tag: string) => void
  onTogglePin?: (id: string) => void
  onToggleTagPin?: () => void
  onRename?: (to: string) => void
}

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
  const exts = createMemo(() => count(shown().map((i) => i.ext)))
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
        <span>{c.text || <NoneText>説明はまだありません</NoneText>}</span>
      )
    if (c.type === 'kids')
      return (
        <Show when={kids().length} fallback={<NoneText>サブタグはありません</NoneText>}>
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
      <Show when={together().length} fallback={<NoneText>関連タグはありません</NoneText>}>
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
              aria-label="タグ名"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && toggleEdit()}
            />
          </h1>
        </Show>
      }
      meta={
        editing()
          ? `タグ名を変更すると、付与されている ${all().length} 件とサブタグも更新されます`
          : `タグ · ${all().length} 件 · ${projectCount()} プロジェクト`
      }
      actions={
        <>
          <PinToggle
            where="ホームに"
            pressed={pinned()}
            onClick={() => {
              setPinned(!pinned())
              props.onToggleTagPin?.()
            }}
          />
          <Button pressed={editing()} onClick={toggleEdit}>
            {editing() ? '編集を完了' : '概要を編集'}
          </Button>
          <IconButton label="その他">
            <Icon name="more" />
          </IconButton>
        </>
      }
      sideLabel="概要"
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
      empty="このタグが付いた項目はありません。"
      pins={lib().pins}
      onTogglePin={props.onTogglePin}
      onOpenItem={props.onOpenItem}
    />
  )
}
