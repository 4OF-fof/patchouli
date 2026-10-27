import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { createStore } from 'solid-js/store'
import { FloatingLabel, FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { type Item, type Library, type TagCandidate, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './TidyScreen.module.css'
import { TidyPanel } from './TidyPanel'
import { Icon } from '../../components/base/Icon/Icon'

export interface TidyScreenProps {
  lib: Library
  currentId?: string
  approved?: string[]
  onOpenItem?: (id: string) => void
}

export function TidyScreen(props: TidyScreenProps) {
  const lib = () => props.lib
  const queue = createMemo(() =>
    lib()
      .items.filter((i) => i.suggestion)
      .toSorted((a, b) => (a.suggestion?.order ?? 0) - (b.suggestion?.order ?? 0)),
  )
  // 候補は画面の中だけで書き換える（ライブラリには戻さない）
  const [draft, setDraft] = createStore<Record<string, { tags: TagCandidate[]; project: string }>>(
    Object.fromEntries(queue().map((i) => [i.id, { tags: structuredClone(i.suggestion?.tags ?? []), project: '' }])),
  )
  const [decided, setDecided] = createSignal<string[]>(props.approved ?? [])
  const [later, setLater] = createSignal<string[]>([])
  const [cur, setCur] = createSignal<string | undefined>(props.currentId)
  const pending = () => queue().filter((i) => !decided().includes(i.id))
  const current = createMemo(() => {
    const c = pending().find((i) => i.id === cur())
    if (c) return c
    return pending().find((i) => !later().includes(i.id)) ?? pending()[0]
  })
  const nextAfter = (id: string) => {
    const q = pending()
    return q[(q.findIndex((x) => x.id === id) + 1) % q.length]?.id
  }
  const onTags = (it: Item) => draft[it.id]?.tags.filter((t) => t.on) ?? []
  const firstTag = (it: Item) => (onTags(it)[0] ?? draft[it.id]?.tags[0])?.tag ?? ''
  const nothing = (it: Item) => !onTags(it).length && !draft[it.id]?.project

  const approve = (it: Item) => {
    if (nothing(it)) return
    const next = nextAfter(it.id)
    setDecided([...decided(), it.id])
    setCur(next)
  }
  const putOff = (it: Item) => {
    const next = nextAfter(it.id)
    setLater([...later(), it.id])
    setCur(next)
  }
  const undo = () => {
    const last = decided().at(-1)
    if (!last) return
    setDecided(decided().slice(0, -1))
    setCur(last)
  }

  const onKey = (e: KeyboardEvent) => {
    const it = current()
    if (!it || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [role="dialog"]'))) return
    if (e.key === 'Enter') {
      e.preventDefault()
      approve(it)
    } else if (e.key === 'ArrowRight') putOff(it)
    else if (e.key === 'ArrowLeft' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) undo()
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const strip = () => (
    <ScrollArea
      axis="x"
      class={styles.stripBox}
      viewClass={styles.strip}
      aria-label="未確認の項目一覧"
      onWheel={(e) => {
        if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
        e.preventDefault()
        e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      <For each={queue()}>
        {(x) => (
          <button
            ref={(el) =>
              // 大きな絵の差し替えで止まらないよう、描き終えてから寄せる
              createEffect(
                () =>
                  x.id === current()?.id &&
                  requestAnimationFrame(() =>
                    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }),
                  ),
              )
            }
            type="button"
            class={styles.q}
            data-later={later().includes(x.id) && !decided().includes(x.id)}
            aria-current={x.id === current()?.id}
            title={x.name}
            aria-label={x.name}
            style={{ '--ar': x.ratio }}
            onClick={() => (decided().includes(x.id) ? props.onOpenItem?.(x.id) : setCur(x.id))}
          >
            <Thumb {...thumbOf(x)} />
            <Show when={decided().includes(x.id)}>
              <i class={styles.ok}>
                <Icon name="check" size={12} />
              </i>
            </Show>
          </button>
        )}
      </For>
    </ScrollArea>
  )

  return (
    <section class={shared.screen} aria-label="整理">
      <div class={styles.head}>
        <FloatingLabel class={styles.mid}>
          <b>整理</b>タグの候補を確認 · 残り {pending().length} 件
        </FloatingLabel>
        <span class={styles.sp} />
        <FloatingPill kbd="←" onClick={undo}>
          元に戻す
        </FloatingPill>
      </div>
      <div class={styles.body}>
        <Show
          when={current()}
          fallback={
            <div class={styles.view}>
              <div class={styles.done}>
                <Show
                  when={later().length}
                  fallback={
                    <>
                      <b>すべての確認が完了しました</b>
                      <span>{decided().length} 件を承認しました。</span>
                    </>
                  }
                >
                  <b>ひと通り確認しました</b>
                  <span>保留にした {later().length} 件は、次回先頭に表示されます。</span>
                </Show>
              </div>
              {strip()}
            </div>
          }
        >
          {(it) => {
            const batch = () => (it().moved === 19 ? queue().filter((x) => x.moved === 19) : [])
            return (
              <>
                <div class={styles.view}>
                  <div class={styles.big}>
                    <Thumb {...thumbOf(it(), 'L')} />
                  </div>
                  {strip()}
                </div>
                <TidyPanel
                  lib={lib()}
                  it={it()}
                  tags={draft[it().id]?.tags ?? []}
                  project={draft[it().id]?.project ?? ''}
                  pos={pending().indexOf(it()) + 1}
                  total={pending().length}
                  later={later().includes(it().id)}
                  approved={decided().length}
                  batch={
                    batch().length
                      ? {
                          size: batch().length,
                          ok: batch().filter(
                            (x) => decided().includes(x.id) && onTags(x).some((t) => t.tag === firstTag(it())),
                          ).length,
                        }
                      : undefined
                  }
                  onTag={(k, on) => setDraft(it().id, 'tags', k, 'on', on)}
                  onProject={(name) => setDraft(it().id, 'project', name)}
                  onPutOff={() => putOff(it())}
                  onApprove={() => approve(it())}
                />
              </>
            )
          }}
        </Show>
      </div>
    </section>
  )
}
