import { For, Index, type JSX, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { Chip } from '../../components/controls/Chip/Chip'
import { middleClick } from '../../components/nav/TabPane/newTab'
import { Button } from '../../components/controls/Button/Button'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { ProgressBar } from '../../components/base/ProgressBar/ProgressBar'
import { counted } from '../../model/filter'
import { type Library, type TagCoverPart, hasTag, newCardId } from '../../model/library'
import { AddPart } from '../Detail/AddPart'
import { DetailPart } from '../Detail/DetailPart'
import { DetailScreen } from '../Detail/DetailScreen'
import { PluginCardView } from '../Detail/PluginCardView'
import { type PartKind, addable } from '../Detail/parts'
import { type CardHost, addableCards, movedShown, newPluginCard, shownCards, withValue } from '../Detail/pluginCards'
import shared from '../screen.module.css'
import styles from './TagScreen.module.css'

type TagPartType = Exclude<TagCoverPart['type'], 'plugin'>

export const TAG_PARTS: Record<TagPartType, PartKind> = {
  desc: { label: '説明', note: 'テキスト', multiple: false },
  kids: { label: 'サブタグ', note: '階層下のタグで絞り込み', multiple: false },
  exts: { label: 'ファイル形式', note: '拡張子ごとの件数', multiple: false },
  together: { label: '関連タグ', note: 'よく併用されるタグ', multiple: false },
}
const TAG_PART_TYPES = ['desc', 'kids', 'exts', 'together'] as const satisfies readonly TagPartType[]

const emptyTagPart = (type: TagPartType): TagCoverPart =>
  type === 'desc' ? { id: newCardId(), type, text: '' } : { id: type, type }

const isTagPartType = (t: string): t is TagPartType => TAG_PART_TYPES.some((x) => x === t)

const labelOf = (c: TagCoverPart) => (c.type === 'plugin' ? '' : TAG_PARTS[c.type].label)

const near = (tag: string, t: string) => t === tag || t.startsWith(tag + '/') || tag.startsWith(t + '/')

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
  onSaveCover?: (cover: TagCoverPart[]) => void
  /** プラグインが足すカード。ないときは、プラグインのカードを出さない。 */
  cards?: CardHost
}

export function TagScreen(props: TagScreenProps) {
  const lib = () => props.lib
  const [pinned, setPinned] = createSignal(!!props.pinned)
  createEffect(
    on(
      () => props.pinned,
      (p) => setPinned(!!p),
      { defer: true },
    ),
  )
  const [editing, setEditing] = createSignal(!!props.editing)
  const [addOpen, setAddOpen] = createSignal(!!props.addOpen)
  const [sub, setSub] = createSignal(props.sub ?? '')
  const [draft, setDraft] = createSignal(props.tag)
  const toggleEdit = () => {
    if (editing()) {
      const to = draft().trim().replace(/^#\s*/, '')
      if (to && to !== props.tag) props.onRename?.(to)
    } else setDraft(props.tag)
    setEditing(!editing())
    setAddOpen(false)
  }
  const cover = () => lib().tagCovers.get(props.tag) ?? []
  const shownCover = createMemo(() => shownCards(props.cards, 'tag', cover()))
  const save = (next: TagCoverPart[]) => props.onSaveCover?.(next)
  const isShown = (c: TagCoverPart) => shownCover().includes(c)
  const pick = (type: string) => {
    const part = isTagPartType(type) ? emptyTagPart(type) : newPluginCard(props.cards, type)
    if (part) save([...cover(), part])
    setAddOpen(false)
  }
  const all = createMemo(() => lib().items.filter((i) => hasTag(i, props.tag)))
  const shown = createMemo(() => (sub() ? all().filter((i) => hasTag(i, sub())) : all()))
  const kids = createMemo(() =>
    [...lib().tagGroups().keys()]
      .filter((t) => t.startsWith(props.tag + '/') && !t.slice(props.tag.length + 1).includes('/'))
      .map((t) => ({ tag: t, n: all().filter((i) => hasTag(i, t)).length }))
      .toSorted((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'ja')),
  )
  const exts = createMemo(() => counted(shown().map((i) => i.ext)))
  const most = () => exts()[0]?.[1] ?? 1
  const together = createMemo(() =>
    counted(shown().flatMap((i) => [...new Set(i.tags)].filter((t) => !near(props.tag, t)))).slice(0, 6),
  )

  const body = (c: TagCoverPart): JSX.Element => {
    if (c.type === 'plugin') return null
    if (c.type === 'desc')
      return editing() ? (
        <textarea
          aria-label="説明"
          value={c.text}
          onChange={(e) => save(cover().map((y) => (y.id === c.id ? { ...c, text: e.currentTarget.value } : y)))}
        />
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
              <Chip onClick={() => props.onOpenTag?.(t)} {...middleClick(() => props.onOpenTag?.(t))}>
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
        <Show when={editing()} fallback={<h1># {props.tag}</h1>}>
          <h1 class={styles.title}>
            <span>#</span>
            <input
              class={shared.nameEdit}
              type="text"
              aria-label="タグ名"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && toggleEdit()}
            />
          </h1>
        </Show>
      }
      meta={
        editing()
          ? `タグ名を変更すると、付与されている ${all().length} 件とサブタグも更新されます`
          : `${all().length} 件`
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
        </>
      }
      sideLabel="概要"
      side={
        <>
          <Index each={shownCover()}>
            {(c, i) => {
              const move = (by: number) => save(movedShown(cover(), isShown, i, by))
              const remove = () => save(cover().filter((y) => y.id !== c().id))
              return (
                <Show
                  when={c().type === 'plugin' && c().id}
                  keyed
                  fallback={
                    <DetailPart label={labelOf(c())} editing={editing()} onMove={move} onRemove={remove}>
                      {body(c())}
                    </DetailPart>
                  }
                >
                  {(id) => (
                    <PluginCardView
                      lib={lib()}
                      host={props.cards}
                      on="tag"
                      name={props.tag}
                      id={id}
                      cover={cover()}
                      items={shown()}
                      editing={editing()}
                      onValue={(v) => save(withValue(cover(), id, v))}
                      onMove={move}
                      onRemove={remove}
                    />
                  )}
                </Show>
              )
            }}
          </Index>
          <Show when={editing()}>
            <AddPart
              parts={[...addable(TAG_PARTS, TAG_PART_TYPES, cover()), ...addableCards(props.cards, 'tag', cover())]}
              open={addOpen()}
              onToggle={() => setAddOpen(!addOpen())}
              onPick={pick}
            />
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
