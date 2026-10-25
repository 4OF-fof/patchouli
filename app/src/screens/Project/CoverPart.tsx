import { For, type JSX, Show } from 'solid-js'
import { Button } from '../../components/Button/Button'
import { ItemCard } from '../../components/ItemCard/ItemCard'
import { Thumb } from '../../components/Thumb/Thumb'
import { type CoverPart, type Library, type Project, dueLabel, relDay, thumbOf } from '../../model/library'
import styles from './CoverPart.module.css'

/** 表紙に足せる部品の名前と説明。 */
export const PARTS: Record<CoverPart['type'], { label: string; note: string }> = {
  desc: { label: '説明', note: '短い文' },
  due: { label: '期日', note: '日付と残り日数' },
  todo: { label: 'やること', note: 'チェックと進み具合' },
  samples: { label: '見本', note: '選んだ素材を並べる' },
  links: { label: 'リンク', note: '外のページ' },
  stats: { label: '数', note: '件数と今週の増分' },
  recent: { label: '最近の動き', note: 'この中で動いたもの' },
}

const none = (s: string) => <span class={styles.none}>{s}</span>

export interface CoverPartViewProps {
  lib: Library
  project: Project
  part: CoverPart
  editing?: boolean
  onOpenItem?: (id: string) => void
}

/** プロジェクトの表紙の部品 1 つ。編集中は入力欄と並べ替えのボタンを出す。 */
export function CoverPartView(props: CoverPartViewProps) {
  const lib = () => props.lib
  const list = () => lib().inProject(props.project.name)
  const body = (): JSX.Element => {
    const c = props.part
    const ed = props.editing
    switch (c.type) {
      case 'desc':
        return ed ? (
          <textarea aria-label="説明" value={c.text} />
        ) : (
          <span>{c.text || none('（説明はまだありません）')}</span>
        )
      case 'due': {
        const d = dueLabel(lib(), c.date)
        return ed ? (
          <input type="date" aria-label="期日" value={c.date} />
        ) : (
          <div class={styles.due}>
            <span class={styles.big}>{d.date}</span>
            <span>{d.left}</span>
          </div>
        )
      }
      case 'todo': {
        const done = c.items.filter((x) => x.done).length
        return (
          <>
            <div class={styles.bar}>
              <span style={{ width: `${c.items.length ? (done / c.items.length) * 100 : 0}%` }} />
            </div>
            <For each={c.items}>
              {(x) => (
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
                  {ed && (
                    <button type="button" class={styles.x} aria-label="消す">
                      ✕
                    </button>
                  )}
                </label>
              )}
            </For>
            {ed && <input type="text" placeholder="やることを足す（Enter）" aria-label="やることを足す" />}
          </>
        )
      }
      case 'samples': {
        const picked = c.refs.flatMap((n) => lib().byName.get(n) ?? [])
        return (
          <>
            <Show when={picked.length} fallback={none('（まだ選んでいません）')}>
              <div class={styles.samp}>
                <For each={picked}>
                  {(x) => (
                    <ItemCard
                      {...thumbOf(x)}
                      name={x.name}
                      showName={false}
                      height={72}
                      onClick={() => props.onOpenItem?.(x.id)}
                    />
                  )}
                </For>
              </div>
            </Show>
            <Show when={ed}>
              <span class={styles.hint}>このプロジェクトの素材から選ぶ</span>
              <div class={styles.pick}>
                <For
                  each={list()
                    .filter((x) => x.kind !== 'note')
                    .slice(0, 24)}
                >
                  {(x) => (
                    <button type="button" aria-pressed={c.refs.includes(x.name)} title={x.name} aria-label={x.name}>
                      <Thumb {...thumbOf(x)} height={40} />
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </>
        )
      }
      case 'links':
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
      case 'stats': {
        const notes = list().filter((x) => x.kind === 'note').length
        return (
          <div class={styles.stat}>
            <div>
              <b>{notes}</b>
              <span>ノート</span>
            </div>
            <div>
              <b>{list().length - notes}</b>
              <span>素材</span>
            </div>
            <div>
              <b>+{list().filter((x) => x.moved <= 7).length}</b>
              <span>今週</span>
            </div>
          </div>
        )
      }
      default:
        return (
          <div class={styles.rec}>
            <For
              each={list()
                .toSorted((a, b) => a.moved - b.moved)
                .slice(0, 5)}
            >
              {(x) => (
                <button type="button" onClick={() => props.onOpenItem?.(x.id)}>
                  <span>{relDay(lib(), x.moved)}</span>
                  <span>{x.name}</span>
                </button>
              )}
            </For>
          </div>
        )
    }
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
