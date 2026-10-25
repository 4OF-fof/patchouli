import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { Kbd } from '../../components/Kbd/Kbd'
import { Thumb } from '../../components/Thumb/Thumb'
import { type Item, type Library, type TagCandidate, monthDay, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './TidyScreen.module.css'

export interface TidyScreenProps {
  lib: Library
  /** 最初に見るもの。省略すると列の先頭。 */
  currentId?: string
  /** もう承認したもの（列に ✓ を付ける）。 */
  approved?: string[]
  backLabel?: string
  onBack?: () => void
  onOpenItem?: (id: string) => void
}

/** 02 整理。自動分類が出したタグの候補を、取り込んだ順に 1 件ずつ承認する。 */
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
    const k = q.findIndex((x) => x.id === id)
    for (let n = 1; n < q.length; n++) {
      const x = q[(k + n) % q.length]
      if (x && !later().includes(x.id)) return x.id
    }
    return undefined
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
  const bulk = (it: Item) => {
    const key = it.suggestion?.key
    const same = pending().filter((x) => x.suggestion?.key === key)
    for (const x of same)
      setDraft(x.id, { tags: structuredClone(draft[it.id]?.tags ?? []), project: draft[it.id]?.project ?? '' })
    setDecided([...decided(), ...same.map((x) => x.id)])
    setCur(undefined)
  }
  const putOff = (it: Item) => {
    const next = nextAfter(it.id)
    setLater([...later(), it.id])
    setCur(next)
  }
  const prev = (it: Item) => {
    const q = pending()
    const k = q.indexOf(it)
    if (k > 0) setCur(q[k - 1]?.id)
  }
  const undo = () => {
    const last = decided().at(-1)
    if (!last) return
    setDecided(decided().slice(0, -1))
    setCur(last)
  }

  const onKey = (e: KeyboardEvent) => {
    const it = current()
    if (!it || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) bulk(it)
      else approve(it)
    } else if (e.key === 'ArrowRight') putOff(it)
    else if (e.key === 'ArrowLeft') prev(it)
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undo()
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const strip = () => (
    <div class={styles.strip} aria-label="確認の列">
      <For each={queue()}>
        {(x) => (
          <button
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
              <i class={styles.ok}>✓</i>
            </Show>
          </button>
        )}
      </For>
    </div>
  )

  return (
    <section class={shared.screen} aria-label="整理">
      <div class={styles.head}>
        <FloatingPill onClick={() => props.onBack?.()}>‹ {props.backLabel ?? '紙面'}</FloatingPill>
        <span class={styles.mid}>
          <b>整理</b>タグの候補を承認する · 残り {pending().length}
        </span>
        <span class={styles.sp} />
        <FloatingPill kbd="Ctrl Z" onClick={undo}>
          取り消す
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
                      <b>確認はすべて終わりました</b>
                      <span>承認 {decided().length} 件。</span>
                    </>
                  }
                >
                  <b>ひと通り見終えました</b>
                  <span>あとでにした {later().length} 件は、次に整理を開いたとき先頭から出ます。</span>
                </Show>
              </div>
              {strip()}
            </div>
          }
        >
          {(it) => {
            const d = () => draft[it().id]
            const pos = () => pending().indexOf(it()) + 1
            const same = () => pending().filter((x) => x.suggestion?.key === it().suggestion?.key).length - 1
            const near = () =>
              lib()
                .items.filter((x) => x.kind !== 'note' && x.id !== it().id && x.tags.includes(firstTag(it())))
                .toSorted((a, b) => Math.abs(a.hue - it().hue) - Math.abs(b.hue - it().hue))
                .slice(0, 6)
            const batch = () => (it().moved === 19 ? queue().filter((x) => x.moved === 19) : [])
            const batchOk = () =>
              batch().filter((x) => decided().includes(x.id) && onTags(x).some((t) => t.tag === firstTag(it()))).length
            const reason = () => (onTags(it()).length ? onTags(it()).map((t) => t.tag) : [firstTag(it())])
            return (
              <>
                <div class={styles.view}>
                  <div class={styles.big}>
                    <Thumb {...thumbOf(it(), 'L')} />
                  </div>
                  {strip()}
                </div>
                <div class={styles.panel} aria-label="候補と理由">
                  <div class={styles.nmh}>
                    <b>{it().name}</b>
                    <small>
                      {pos()} / {pending().length} · {monthDay(lib(), it().moved)} 取り込み
                      {later().includes(it().id) && ' · あとでにしたもの'}
                      {decided().length > 0 && ` · 承認 ${decided().length}`}
                    </small>
                  </div>
                  <div class={styles.fl}>
                    <span class={styles.sub}>タグ</span>
                    <div class={styles.cands}>
                      <For each={d()?.tags}>
                        {(t, k) => (
                          <label class={styles.cand} data-on={t.on}>
                            <input
                              type="checkbox"
                              checked={t.on}
                              onChange={(e) => setDraft(it().id, 'tags', k(), 'on', e.currentTarget.checked)}
                            />
                            <span># {t.tag}</span>
                            <small>{t.conf}</small>
                          </label>
                        )}
                      </For>
                      <input class={styles.tagin} type="text" placeholder="＋ タグを入力" aria-label="タグを足す" />
                    </div>
                  </div>
                  <div class={styles.fl}>
                    <span class={styles.sub}>プロジェクト</span>
                    <div class={styles.pselect}>
                      <select
                        aria-label="プロジェクトに入れる"
                        value={d()?.project ?? ''}
                        onChange={(e) => setDraft(it().id, 'project', e.currentTarget.value)}
                      >
                        <option value="">入れない</option>
                        <For each={lib().projects.filter((p) => p.name !== '日記')}>
                          {(p) => <option>{p.name}</option>}
                        </For>
                      </select>
                    </div>
                  </div>
                  <Show when={same() > 0}>
                    <div class={styles.bulk}>
                      <span>
                        この内容を、同じ候補の残り <b>{same()}</b> 件にも
                      </span>
                      <button type="button" disabled={nothing(it())} onClick={() => bulk(it())}>
                        まとめて承認 <Kbd>Shift Enter</Kbd>
                      </button>
                    </div>
                  </Show>
                  <div class={styles.fl}>
                    <span class={styles.sub}># {firstTag(it())} の付いたものの中で近いもの</span>
                    <div class={styles.near}>
                      <For each={near()} fallback={<span class={styles.hint}>まだありません</span>}>
                        {(x) => <Thumb {...thumbOf(x)} />}
                      </For>
                    </div>
                  </div>
                  <div class={styles.why}>
                    <span class={styles.sub}>候補になった理由</span>
                    <Show when={batchOk()}>
                      <span>
                        {monthDay(lib(), 19)} に一緒に取り込んだ {batch().length} 件のうち、{batchOk()} 件に #{' '}
                        {firstTag(it())} を承認済み。
                      </span>
                    </Show>
                    <span>
                      {reason()
                        .map((t) => `# ${t}`)
                        .join(' と ')}{' '}
                      の付いたものと近い。
                    </span>
                  </div>
                  <div class={styles.dec}>
                    <button
                      type="button"
                      class={styles.prev}
                      aria-label="前へ"
                      disabled={pos() <= 1}
                      onClick={() => prev(it())}
                    >
                      ‹
                    </button>
                    <button type="button" onClick={() => putOff(it())}>
                      あとで <Kbd>→</Kbd>
                    </button>
                    <button type="button" class={styles.ok2} disabled={nothing(it())} onClick={() => approve(it())}>
                      ✓ 承認する <Kbd>Enter</Kbd>
                    </button>
                  </div>
                </div>
              </>
            )
          }}
        </Show>
      </div>
    </section>
  )
}
