import { For, Show } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { Select } from '../../components/controls/Select/Select'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { type Item, type Library, type TagCandidate, thumbOf } from '../../model/library'
import styles from './TidyPanel.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export interface TidyPanelProps {
  class?: string
  lib: Library
  it: Item
  tags: TagCandidate[]
  project: string
  pos: number
  total: number
  later?: boolean
  onTag: (k: number, on: boolean) => void
  onProject: (name: string) => void
  onAddTag?: (tag: string) => void
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
  return (
    <ScrollArea class={`${styles.root} ${props.class ?? ''}`} viewClass={styles.body} aria-label="分類の候補">
      <div class={styles.nmh}>
        <b>{props.it.name}</b>
        <small>
          {props.pos} / {props.total}
          {props.later && ' | 保留中'}
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
                <Show when={t.conf}>
                  <small>{t.conf}</small>
                </Show>
              </label>
            )}
          </For>
          <Show when={!props.tags.length}>
            <span class={styles.hint}>候補はありません</span>
          </Show>
          <input
            class={styles.tagin}
            type="text"
            placeholder="＋ タグを追加"
            aria-label="タグを追加"
            onKeyDown={(e) => {
              const tag = e.currentTarget.value.trim()
              if (e.key !== 'Enter' || e.isComposing || !tag) return
              e.preventDefault()
              props.onAddTag?.(tag)
              e.currentTarget.value = ''
            }}
          />
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
      <Show when={firstTag()}>
        <div class={styles.fl}>
          <span class={styles.sub}># {firstTag()} の類似項目</span>
          <div class={styles.near}>
            <For each={near()} fallback={<span class={styles.hint}>まだありません</span>}>
              {(x) => <Thumb {...thumbOf(x)} />}
            </For>
          </div>
        </div>
      </Show>
      <div class={styles.dec}>
        <button type="button" onClick={() => props.onPutOff()}>
          保留 <Kbd>→</Kbd>
        </button>
        <button type="button" class={styles.ok2} disabled={nothing()} onClick={() => props.onApprove()}>
          <Icon name="check" size={14} withText />
          承認 <Kbd>Enter</Kbd>
        </button>
      </div>
    </ScrollArea>
  )
}
