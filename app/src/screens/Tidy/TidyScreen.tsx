import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { Button } from '../../components/controls/Button/Button'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { ConfirmDialog } from '../../components/dialog/ConfirmDialog/ConfirmDialog'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { createStore } from 'solid-js/store'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { useTabActive } from '../../components/nav/TabPane/TabPane'
import { type Item, type Library, type TagCandidate, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './TidyScreen.module.css'
import { TidyPanel } from './TidyPanel'
import { Icon } from '../../components/base/Icon/Icon'

export interface TidyDecision {
  tags: string[]
  /** 選ばなかった候補 */
  rejected: string[]
  project: string | null
}

export interface TidyScreenProps {
  lib: Library
  currentId?: string
  approved?: string[]
  onOpenItem?: (id: string) => void
  onApprove?: (it: Item, d: TidyDecision) => void
  /** before は承認する前の項目 */
  onUndo?: (before: Item) => void
}

// 保留にしたものは、アプリを閉じるまで覚えておき、次に整理を開いたときに先頭に出す
let heldOver: string[] = []

const HIGH = '類似度：高'

const fresh = (i: Item) => ({ tags: structuredClone(i.suggestion?.tags ?? []), project: i.project ?? '' })

export function TidyScreen(props: TidyScreenProps) {
  const lib = () => props.lib
  const firstOrder = () => {
    const ids = lib()
      .pending()
      .map((i) => i.id)
    const held = heldOver.filter((id) => ids.includes(id))
    return [...held, ...ids.filter((id) => !held.includes(id))]
  }
  const [order, setOrder] = createSignal(firstOrder())
  const queue = createMemo(() => order().flatMap((id) => lib().byId.get(id) ?? []))
  // 候補は画面の中だけで書き換える（ライブラリには戻さない）
  const [draft, setDraft] = createStore<Record<string, { tags: TagCandidate[]; project: string }>>(
    Object.fromEntries(queue().map((i) => [i.id, fresh(i)])),
  )
  // 承認と保留を、した順に並べる。held は、その前に保留の記憶にあったか
  const [steps, setSteps] = createSignal<{ id: string; later?: boolean; before?: Item; held?: boolean }[]>(
    (props.approved ?? []).map((id) => ({ id })),
  )
  const decided = createMemo(() => steps().filter((s) => !s.later))
  const decidedIds = createMemo(() => new Set(decided().map((d) => d.id)))
  // 候補は作り直すたびに届く。並びは変えず、新しく候補の出たものを後ろに足す
  createEffect(
    on(
      lib,
      (l) => {
        const kept = order().filter((id) => decidedIds().has(id) || l.byId.get(id)?.tags.length === 0)
        const have = new Set(kept)
        const added = l.pending().filter((i) => !have.has(i.id))
        for (const i of added) if (!draft[i.id]) setDraft(i.id, fresh(i))
        if (added.length || kept.length !== order().length) setOrder([...kept, ...added.map((i) => i.id)])
      },
      { defer: true },
    ),
  )
  const later = createMemo(() => steps().flatMap((s) => (s.later ? [s.id] : [])))
  const [cur, setCur] = createSignal<string | undefined>(props.currentId)
  const [bulk, setBulk] = createSignal(false)
  const pending = () => queue().filter((i) => !decidedIds().has(i.id))
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
  const nothing = (it: Item) => !onTags(it).length && (draft[it.id]?.project ?? '') === (it.project ?? '')
  const sure = () =>
    pending().filter((it) => {
      const chosen = onTags(it)
      return chosen.length > 0 && chosen.every((t) => t.conf === HIGH)
    })

  const decide = (it: Item) => {
    const d = draft[it.id]
    heldOver = heldOver.filter((id) => id !== it.id)
    props.onApprove?.(it, {
      tags: onTags(it).map((t) => t.tag),
      rejected: d?.tags.filter((t) => !t.on).map((t) => t.tag) ?? [],
      project: d?.project || null,
    })
  }
  const approve = (it: Item) => {
    if (nothing(it)) return
    const next = nextAfter(it.id)
    setSteps([...steps(), { id: it.id, before: it, held: heldOver.includes(it.id) }])
    setCur(next)
    decide(it)
  }
  const approveSure = () => {
    const its = sure()
    setBulk(false)
    setSteps([...steps(), ...its.map((it) => ({ id: it.id, before: it, held: heldOver.includes(it.id) }))])
    for (const it of its) decide(it)
  }
  const putOff = (it: Item) => {
    const next = nextAfter(it.id)
    const held = heldOver.includes(it.id)
    setSteps([...steps(), { id: it.id, later: true, held }])
    if (!held) heldOver = [...heldOver, it.id]
    setCur(next)
  }
  const undo = () => {
    const last = steps().at(-1)
    if (!last) return
    setSteps(steps().slice(0, -1))
    setCur(last.id)
    if (last.held != null) heldOver = [...heldOver.filter((id) => id !== last.id), ...(last.held ? [last.id] : [])]
    if (last.before) props.onUndo?.(last.before)
  }
  const addTag = (it: Item, tag: string) => {
    const k = draft[it.id]?.tags.findIndex((t) => t.tag === tag) ?? -1
    if (k >= 0) setDraft(it.id, 'tags', k, 'on', true)
    else setDraft(it.id, 'tags', (ts) => [...ts, { tag, conf: '', on: true }])
  }

  const active = useTabActive()
  const onKey = (e: KeyboardEvent) => {
    const it = current()
    if (!active() || bulk()) return
    if (!it || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [role="dialog"]'))) return
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (sure().length) setBulk(true)
    } else if (e.key === 'Enter') {
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
            data-later={later().includes(x.id) && !decidedIds().has(x.id)}
            aria-current={x.id === current()?.id}
            data-tip={x.name}
            aria-label={x.name}
            style={{ '--ar': x.ratio }}
            onClick={() => (decidedIds().has(x.id) ? props.onOpenItem?.(x.id) : setCur(x.id))}
          >
            <Thumb {...thumbOf(x)} />
            <Show when={decidedIds().has(x.id)}>
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
        <FloatingPill kbd="Ctrl Enter" disabled={!sure().length} onClick={() => setBulk(true)}>
          まとめて承認
        </FloatingPill>
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
                  class={styles.panel}
                  lib={lib()}
                  it={it()}
                  tags={draft[it().id]?.tags ?? []}
                  project={draft[it().id]?.project ?? ''}
                  pos={pending().indexOf(it()) + 1}
                  total={pending().length}
                  later={later().includes(it().id)}
                  batch={
                    batch().length
                      ? {
                          size: batch().length,
                          ok: batch().filter(
                            (x) => decidedIds().has(x.id) && onTags(x).some((t) => t.tag === firstTag(it())),
                          ).length,
                        }
                      : undefined
                  }
                  onTag={(k, v) => setDraft(it().id, 'tags', k, 'on', v)}
                  onProject={(name) => setDraft(it().id, 'project', name)}
                  onAddTag={(tag) => addTag(it(), tag)}
                  onPutOff={() => putOff(it())}
                  onApprove={() => approve(it())}
                />
              </>
            )
          }}
        </Show>
      </div>
      <Show when={bulk()}>
        <ConfirmDialog
          label="まとめて承認"
          title={`${sure().length} 件をまとめて承認します`}
          onClose={() => setBulk(false)}
          onEnter={approveSure}
          footer={
            <>
              <Button variant="ghost" onClick={() => setBulk(false)}>
                キャンセル <Kbd>Esc</Kbd>
              </Button>
              <Button variant="primary" onClick={approveSure}>
                承認 <Kbd>Enter</Kbd>
              </Button>
            </>
          }
        >
          <p>選択中の候補がすべて「{HIGH}」の項目を、そのタグで承認しますか？</p>
        </ConfirmDialog>
      </Show>
    </section>
  )
}
