import { For, Show } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { Select } from '../../components/controls/Select/Select'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { type Item, type Library, type TagCandidate, monthDay, thumbOf } from '../../model/library'
import styles from './TidyPanel.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface TidyPanelProps {
  lib: Library
  it: Item
  tags: TagCandidate[]
  project: string
  pos: number
  total: number
  later?: boolean
  approved: number
  batch?: { size: number; ok: number }
  onTag: (k: number, on: boolean) => void
  onProject: (name: string) => void
  onPutOff: () => void
  onApprove: () => void
}

export function TidyPanel(props: TidyPanelProps) {
  const lib = () => props.lib
  const onTags = () => props.tags.filter((t) => t.on)
  const firstTag = () => (onTags()[0] ?? props.tags[0])?.tag ?? ''
  const nothing = () => !onTags().length && !props.project
  const near = () =>
    lib()
      .items.filter((x) => !x.note && x.id !== props.it.id && x.tags.includes(firstTag()))
      .toSorted((a, b) => Math.abs(a.hue - props.it.hue) - Math.abs(b.hue - props.it.hue))
      .slice(0, 6)
  const reason = () => (onTags().length ? onTags().map((t) => t.tag) : [firstTag()])
  return (
    <ScrollArea class={styles.root} viewClass={styles.body} aria-label="分類の候補">
      <div class={styles.nmh}>
        <b>{props.it.name}</b>
        <small>
          {props.pos} / {props.total} · {monthDay(lib(), props.it.moved)} に追加
          {props.later && ' · 保留中'}
          {props.approved > 0 && ` · 承認済み ${props.approved} 件`}
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
                  <i class={styles.mark}>
                    <Icon name={t.on ? 'check' : 'hash'} size={12} />
                  </i>
                  {t.tag}
                </span>
                <small>{t.conf}</small>
              </label>
            )}
          </For>
          <input class={styles.tagin} type="text" placeholder="＋ タグを追加" aria-label="タグを追加" />
        </div>
      </div>
      <div class={styles.fl}>
        <span class={styles.sub}>プロジェクト</span>
        <Select
          aria-label="プロジェクトを選択"
          value={props.project}
          options={[
            { value: '', label: '指定なし' },
            ...lib()
              .projects.filter((p) => p.name !== '日記')
              .map((p) => ({ value: p.name, label: p.name })),
          ]}
          onChange={(v) => props.onProject(v)}
        />
      </div>
      <div class={styles.fl}>
        <span class={styles.sub}># {firstTag()} の類似項目</span>
        <div class={styles.near}>
          <For each={near()} fallback={<span class={styles.hint}>まだありません</span>}>
            {(x) => <Thumb {...thumbOf(x)} />}
          </For>
        </div>
      </div>
      <div class={styles.why}>
        <span class={styles.sub}>提案の理由</span>
        <Show when={props.batch?.ok}>
          <span>
            {monthDay(lib(), props.it.moved)} に同時追加した {props.batch?.size} 件のうち {props.batch?.ok} 件で #{' '}
            {firstTag()} を承認済み
          </span>
        </Show>
        <span>
          {reason()
            .map((t) => `# ${t}`)
            .join('・')}
          の項目と類似
        </span>
      </div>
      <div class={styles.dec}>
        <button type="button" onClick={() => props.onPutOff()}>
          保留 <Kbd>→</Kbd>
        </button>
        <button type="button" class={styles.ok2} disabled={nothing()} onClick={() => props.onApprove()}>
          <Icon name="check" size={14} />
          承認 <Kbd>Enter</Kbd>
        </button>
      </div>
    </ScrollArea>
  )
}
