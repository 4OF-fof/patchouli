import { For, type JSX, Show } from 'solid-js'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { Button } from '../../components/controls/Button/Button'
import { Checkbox } from '../../components/controls/Checkbox/Checkbox'
import { DateField } from '../../components/controls/DateField/DateField'
import { ProgressBar } from '../../components/base/ProgressBar/ProgressBar'
import { type CoverPart, type Library, dueLabel } from '../../model/library'
import { DetailPart } from '../Detail/DetailPart'
import styles from './CoverPart.module.css'
import { Icon } from '../../components/base/Icon/Icon'

export const PARTS: Record<CoverPart['type'], { label: string; note: string }> = {
  desc: { label: '説明', note: 'テキスト' },
  todo: { label: 'タスク', note: 'チェックリストと期日' },
  links: { label: 'リンク', note: '外部 URL' },
}

export interface CoverPartViewProps {
  lib: Library
  part: CoverPart
  editing?: boolean
}

export function CoverPartView(props: CoverPartViewProps) {
  const lib = () => props.lib
  const body = (): JSX.Element => {
    const c = props.part
    const ed = props.editing
    if (c.type === 'desc')
      return ed ? (
        <textarea aria-label="説明" value={c.text} />
      ) : (
        <span>{c.text || <NoneText>説明はまだありません</NoneText>}</span>
      )
    if (c.type === 'links')
      return (
        <>
          <Show when={c.items.length} fallback={<NoneText>リンクはまだありません</NoneText>}>
            <For each={c.items}>
              {(x) => (
                <span class={styles.link}>
                  <a href={x.u} target="_blank" rel="noopener">
                    {x.t}
                    <Icon name="external" size={12} withText />
                  </a>
                  {ed && (
                    <button type="button" class={styles.x} aria-label="削除">
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </span>
              )}
            </For>
          </Show>
          <Show when={ed}>
            <input type="text" placeholder="タイトル" aria-label="リンクのタイトル" />
            <input type="url" placeholder="https://" aria-label="リンクの URL" />
            <Button size="sm">リンクを追加</Button>
          </Show>
        </>
      )
    const done = c.items.filter((x) => x.done).length
    return (
      <>
        <ProgressBar value={done / c.items.length} />
        <For each={c.items}>
          {(x) => {
            const due = x.due ? dueLabel(lib(), x.due) : null
            return (
              <label class={styles.todo} data-done={x.done}>
                <Checkbox class={styles.check} checked={x.done} />
                <span>
                  {x.t}
                  {x.ref && (
                    <>
                      （<span class={styles.wl}>{x.ref}</span>）
                    </>
                  )}
                </span>
                {ed ? (
                  <>
                    <DateField
                      class={styles.dueField}
                      aria-label={`${x.t} の期日`}
                      placeholder="期日なし"
                      value={x.due ?? ''}
                      today={lib().today}
                    />
                    <button type="button" class={styles.x} aria-label="削除">
                      <Icon name="close" size={14} />
                    </button>
                  </>
                ) : (
                  <Show when={due}>
                    {(d) => (
                      <span class={styles.due} data-tip={d().left} data-late={!x.done && d().late}>
                        {d().date}
                      </span>
                    )}
                  </Show>
                )}
              </label>
            )
          }}
        </For>
        {ed && <input type="text" placeholder="タスクを追加（Enter）" aria-label="タスクを追加" />}
      </>
    )
  }
  const label = () => {
    const c = props.part
    return c.type === 'todo'
      ? `タスク · ${c.items.filter((x) => x.done).length} / ${c.items.length}`
      : PARTS[c.type].label
  }
  return (
    <DetailPart class={styles.root} label={label()} editing={props.editing}>
      {body()}
    </DetailPart>
  )
}
