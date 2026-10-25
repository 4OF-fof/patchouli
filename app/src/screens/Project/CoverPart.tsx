import { For, type JSX, Show } from 'solid-js'
import { Button } from '../../components/Button/Button'
import { type CoverPart, type Library, dueLabel } from '../../model/library'
import styles from './CoverPart.module.css'

/** 表紙に足せる部品の名前と説明。 */
export const PARTS: Record<CoverPart['type'], { label: string; note: string }> = {
  desc: { label: '説明', note: '短い文' },
  todo: { label: 'やること', note: 'チェックと期日' },
  links: { label: 'リンク', note: '外のページ' },
}

const none = (s: string) => <span class={styles.none}>{s}</span>

export interface CoverPartViewProps {
  lib: Library
  part: CoverPart
  editing?: boolean
}

/** プロジェクトの表紙の部品 1 つ。編集中は入力欄と並べ替えのボタンを出す。 */
export function CoverPartView(props: CoverPartViewProps) {
  const lib = () => props.lib
  const body = (): JSX.Element => {
    const c = props.part
    const ed = props.editing
    if (c.type === 'desc')
      return ed ? (
        <textarea aria-label="説明" value={c.text} />
      ) : (
        <span>{c.text || none('（説明はまだありません）')}</span>
      )
    if (c.type === 'links')
      return (
        <>
          <Show when={c.items.length} fallback={none('（リンクはまだありません）')}>
            <For each={c.items}>
              {(x) => (
                <span class={styles.link}>
                  <a href={x.u} target="_blank" rel="noopener">
                    {x.t} ↗
                  </a>
                  {ed && (
                    <button type="button" class={styles.x} aria-label="消す">
                      ✕
                    </button>
                  )}
                </span>
              )}
            </For>
          </Show>
          <Show when={ed}>
            <input type="text" placeholder="名前" aria-label="リンクの名前" />
            <input type="url" placeholder="https://" aria-label="リンクの URL" />
            <Button size="sm">リンクを足す</Button>
          </Show>
        </>
      )
    const done = c.items.filter((x) => x.done).length
    return (
      <>
        <div class={styles.bar}>
          <span style={{ width: `${c.items.length ? (done / c.items.length) * 100 : 0}%` }} />
        </div>
        <For each={c.items}>
          {(x) => {
            const due = x.due ? dueLabel(lib(), x.due) : null
            return (
              <label class={styles.todo} data-done={x.done}>
                <input type="checkbox" checked={x.done} />
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
                    <input type="date" class={styles.due} aria-label={`${x.t} の期日`} value={x.due ?? ''} />
                    <button type="button" class={styles.x} aria-label="消す">
                      ✕
                    </button>
                  </>
                ) : (
                  <Show when={due}>
                    {(d) => (
                      <span class={styles.due} title={d().left} data-late={!x.done && d().late}>
                        {d().date}
                      </span>
                    )}
                  </Show>
                )}
              </label>
            )
          }}
        </For>
        {ed && <input type="text" placeholder="やることを足す（Enter）" aria-label="やることを足す" />}
      </>
    )
  }
  const label = () => {
    const c = props.part
    return c.type === 'todo'
      ? `やること · ${c.items.filter((x) => x.done).length} / ${c.items.length}`
      : PARTS[c.type].label
  }
  return (
    <div class={styles.root} data-editing={props.editing}>
      {props.editing && (
        <span class={styles.ctl}>
          <button type="button" aria-label="上へ">
            ↑
          </button>
          <button type="button" aria-label="下へ">
            ↓
          </button>
          <button type="button" class={styles.del} aria-label="外す">
            ✕
          </button>
        </span>
      )}
      <span class={styles.k}>{label()}</span>
      {body()}
    </div>
  )
}

/** 編集中に出す「＋ 部品を足す」と、その一覧。 */
export function AddPart(props: { open?: boolean; onToggle?: () => void }) {
  return (
    <>
      <button type="button" class={styles.add} aria-expanded={!!props.open} onClick={() => props.onToggle?.()}>
        ＋ 部品を足す
      </button>
      <Show when={props.open}>
        <div class={styles.menu}>
          <For each={Object.values(PARTS)}>
            {(p) => (
              <button type="button">
                <span>{p.label}</span>
                <small>{p.note}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}
