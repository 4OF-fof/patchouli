import { For, Index, Match, Show, Switch, createSignal } from 'solid-js'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { Button } from '../../components/controls/Button/Button'
import { Checkbox } from '../../components/controls/Checkbox/Checkbox'
import { DateField } from '../../components/controls/DateField/DateField'
import { ProgressBar } from '../../components/base/ProgressBar/ProgressBar'
import { type CoverPart, type Library, dueLabel, newCardId } from '../../model/library'
import { DetailPart } from '../Detail/DetailPart'
import type { PartKind } from '../Detail/parts'
import styles from './CoverPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export const PARTS: Record<CoverPart['type'], PartKind> = {
  desc: { label: '説明', note: 'テキスト', multiple: true },
  todo: { label: 'タスク', note: 'チェックリストと期日', multiple: true },
  links: { label: 'リンク', note: '外部 URL', multiple: true },
}
export const PART_TYPES = ['desc', 'todo', 'links'] as const satisfies readonly CoverPart['type'][]

export function emptyPart(type: CoverPart['type']): CoverPart {
  const id = newCardId()
  return type === 'desc' ? { id, type, text: '' } : { id, type, items: [] }
}

type Todo = Extract<CoverPart, { type: 'todo' }>
type Links = Extract<CoverPart, { type: 'links' }>

export interface CoverPartViewProps {
  lib: Library
  part: CoverPart
  editing?: boolean
  onChange?: (part: CoverPart) => void
  onUp?: () => void
  onDown?: () => void
  onRemove?: () => void
}

function TodoBody(props: { lib: Library; part: Todo; editing?: boolean; onChange: (p: Todo) => void }) {
  const items = () => props.part.items
  const set = (i: number, x: Partial<Todo['items'][number]>) =>
    props.onChange({ ...props.part, items: items().map((y, k) => (k === i ? { ...y, ...x } : y)) })
  const add = (el: HTMLInputElement) => {
    const t = el.value.trim()
    if (!t) return
    props.onChange({ ...props.part, items: [...items(), { t, done: false }] })
    el.value = ''
  }
  return (
    <>
      <Show when={items().length}>
        <ProgressBar value={items().filter((x) => x.done).length / items().length} />
      </Show>
      <Index each={items()} fallback={!props.editing && <NoneText>タスクはまだありません</NoneText>}>
        {(x, i) => {
          const due = () => (x().due ? dueLabel(props.lib, x().due ?? '') : null)
          const ref = () => (x().ref ? props.lib.byId.get(x().ref ?? '')?.name : undefined)
          const check = (
            <Checkbox
              class={styles.check}
              checked={x().done}
              onChange={(e) => set(i, { done: e.currentTarget.checked })}
            />
          )
          return (
            <Show
              when={props.editing}
              fallback={
                <label class={styles.todo} data-done={x().done}>
                  {check}
                  <span>
                    {x().t}
                    <Show when={ref()}>
                      {(r) => (
                        <>
                          （<span class={styles.wl}>{r()}</span>）
                        </>
                      )}
                    </Show>
                  </span>
                  <Show when={due()}>
                    {(d) => (
                      <span class={styles.due} data-tip={d().left} data-late={!x().done && d().late}>
                        {d().date}
                      </span>
                    )}
                  </Show>
                </label>
              }
            >
              <div class={styles.todo} data-done={x().done}>
                {check}
                <input
                  type="text"
                  aria-label="タスク"
                  value={x().t}
                  onChange={(e) => {
                    const t = e.currentTarget.value.trim()
                    if (t) set(i, { t })
                    else e.currentTarget.value = x().t
                  }}
                />
                <DateField
                  class={styles.dueField}
                  aria-label={`${x().t} の期日`}
                  placeholder="期日なし"
                  value={x().due ?? ''}
                  today={props.lib.today}
                  onChange={(v) => set(i, { due: v || undefined })}
                />
                <button
                  type="button"
                  class={styles.x}
                  aria-label="削除"
                  onClick={() => props.onChange({ ...props.part, items: items().filter((_, k) => k !== i) })}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </Show>
          )
        }}
      </Index>
      <Show when={props.editing}>
        <input
          type="text"
          placeholder="タスクを追加（Enter）"
          aria-label="タスクを追加"
          onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && add(e.currentTarget)}
        />
      </Show>
    </>
  )
}

function LinksBody(props: { part: Links; editing?: boolean; onChange: (p: Links) => void }) {
  const [title, setTitle] = createSignal('')
  const [url, setUrl] = createSignal('')
  const add = () => {
    const u = url().trim()
    if (!u) return
    props.onChange({ ...props.part, items: [...props.part.items, { t: title().trim() || u, u }] })
    setTitle('')
    setUrl('')
  }
  return (
    <>
      <Show when={props.part.items.length} fallback={<NoneText>リンクはまだありません</NoneText>}>
        <For each={props.part.items}>
          {(x, i) => (
            <span class={styles.link}>
              <a href={x.u} target="_blank" rel="noopener">
                {x.t}
                <Icon name="external" size={12} withText />
              </a>
              {props.editing && (
                <button
                  type="button"
                  class={styles.x}
                  aria-label="削除"
                  onClick={() => props.onChange({ ...props.part, items: props.part.items.filter((_, k) => k !== i()) })}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </span>
          )}
        </For>
      </Show>
      <Show when={props.editing}>
        <input
          type="text"
          placeholder="タイトル"
          aria-label="リンクのタイトル"
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
        <input
          type="url"
          placeholder="https://"
          aria-label="リンクの URL"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && add()}
        />
        <Button size="sm" disabled={!url().trim()} onClick={add}>
          リンクを追加
        </Button>
      </Show>
    </>
  )
}

export function CoverPartView(props: CoverPartViewProps) {
  const change = (p: CoverPart) => props.onChange?.(p)
  const desc = () => (props.part.type === 'desc' ? props.part : undefined)
  const links = () => (props.part.type === 'links' ? props.part : undefined)
  const todo = () => (props.part.type === 'todo' ? props.part : undefined)
  const label = () => {
    const c = props.part
    return c.type === 'todo'
      ? `タスク · ${c.items.filter((x) => x.done).length} / ${c.items.length}`
      : PARTS[c.type].label
  }
  return (
    <DetailPart
      class={styles.root}
      label={label()}
      editing={props.editing}
      onUp={props.onUp}
      onDown={props.onDown}
      onRemove={props.onRemove}
    >
      <Switch>
        <Match when={desc()}>
          {(c) => (
            <Show when={props.editing} fallback={<span>{c().text || <NoneText>説明はまだありません</NoneText>}</span>}>
              <textarea
                aria-label="説明"
                value={c().text}
                onChange={(e) => change({ ...c(), text: e.currentTarget.value })}
              />
            </Show>
          )}
        </Match>
        <Match when={links()}>{(c) => <LinksBody part={c()} editing={props.editing} onChange={change} />}</Match>
        <Match when={todo()}>
          {(c) => <TodoBody lib={props.lib} part={c()} editing={props.editing} onChange={change} />}
        </Match>
      </Switch>
    </DetailPart>
  )
}
