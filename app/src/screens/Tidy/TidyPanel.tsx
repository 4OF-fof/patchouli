import { For, Show } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { type Item, type Library, type TagCandidate, monthDay, thumbOf } from '../../model/library'
import styles from './TidyPanel.module.css'

export interface TidyPanelProps {
  lib: Library
  it: Item
  /** 画面の中で書き換えている候補。 */
  tags: TagCandidate[]
  project: string
  /** 承認待ちの中で何番目か（1 から）と、全部で何件か。 */
  pos: number
  total: number
  /** あとでにしたもの。 */
  later?: boolean
  /** もう承認した件数。 */
  approved: number
  /** 一緒に取り込んだもの（何件のうち、何件に同じタグを承認したか）。 */
  batch?: { size: number; ok: number }
  onTag: (k: number, on: boolean) => void
  onProject: (name: string) => void
  onPutOff: () => void
  onApprove: () => void
}

/** 整理画面の右の欄。タグとプロジェクトの候補、近いもの、候補になった理由、承認とあとで。 */
export function TidyPanel(props: TidyPanelProps) {
  const lib = () => props.lib
  const onTags = () => props.tags.filter((t) => t.on)
  const firstTag = () => (onTags()[0] ?? props.tags[0])?.tag ?? ''
  const nothing = () => !onTags().length && !props.project
  const near = () =>
    lib()
      .items.filter((x) => x.kind !== 'note' && x.id !== props.it.id && x.tags.includes(firstTag()))
      .toSorted((a, b) => Math.abs(a.hue - props.it.hue) - Math.abs(b.hue - props.it.hue))
      .slice(0, 6)
  const reason = () => (onTags().length ? onTags().map((t) => t.tag) : [firstTag()])
  return (
    <ScrollArea class={styles.root} viewClass={styles.body} aria-label="候補と理由">
      <div class={styles.nmh}>
        <b>{props.it.name}</b>
        <small>
          {props.pos} / {props.total} · {monthDay(lib(), props.it.moved)} 取り込み
          {props.later && ' · あとでにしたもの'}
          {props.approved > 0 && ` · 承認 ${props.approved}`}
        </small>
      </div>
      <div class={styles.fl}>
        <span class={styles.sub}>タグ</span>
        <div class={styles.cands}>
          <For each={props.tags}>
            {(t, k) => (
              <label class={styles.cand} data-on={t.on}>
                <input type="checkbox" checked={t.on} onChange={(e) => props.onTag(k(), e.currentTarget.checked)} />
                <span>
                  <i class={styles.mark}>{t.on ? '✓' : '#'}</i>
                  {t.tag}
                </span>
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
            value={props.project}
            onChange={(e) => props.onProject(e.currentTarget.value)}
          >
            <option value="">入れない</option>
            <For each={lib().projects.filter((p) => p.name !== '日記')}>{(p) => <option>{p.name}</option>}</For>
          </select>
        </div>
      </div>
      <div class={styles.fl}>
        <span class={styles.sub}># {firstTag()} の付いたものの中で近いもの</span>
        <div class={styles.near}>
          <For each={near()} fallback={<span class={styles.hint}>まだありません</span>}>
            {(x) => <Thumb {...thumbOf(x)} />}
          </For>
        </div>
      </div>
      <div class={styles.why}>
        <span class={styles.sub}>候補になった理由</span>
        <Show when={props.batch?.ok}>
          <span>
            {monthDay(lib(), props.it.moved)} に一緒に取り込んだ {props.batch?.size} 件のうち、{props.batch?.ok} 件に #{' '}
            {firstTag()} を承認済み。
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
        <button type="button" onClick={() => props.onPutOff()}>
          あとで <Kbd>→</Kbd>
        </button>
        <button type="button" class={styles.ok2} disabled={nothing()} onClick={() => props.onApprove()}>
          ✓ 承認する <Kbd>Enter</Kbd>
        </button>
      </div>
    </ScrollArea>
  )
}
