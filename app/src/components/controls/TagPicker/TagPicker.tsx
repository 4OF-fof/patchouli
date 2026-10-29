import { For, type JSX, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import { NoneText } from '../../base/NoneText/NoneText'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './TagPicker.module.css'

export interface TagPickerProps {
  tags: string[]
  /** 選んだもののうち一部にだけ付いているタグと、添える文字（「2/5」など）。押すとすべてに付ける。 */
  mixed?: Record<string, string>
  all: string[]
  recent: string[]
  /** 取得中は undefined */
  suggested?: string[]
  onToggle: (tag: string, on: boolean) => void
  onClose: () => void
  /** ここを押しても、外を押したことにしない */
  anchor?: HTMLElement
  class?: string
  style?: JSX.CSSProperties
}

const clean = (s: string) => s.trim().replace(/^#\s*/, '')

export function TagPicker(props: TagPickerProps) {
  let el!: HTMLDivElement
  let input!: HTMLInputElement
  const [q, setQ] = createSignal('')
  const known = createMemo(() => new Set(props.all))
  const match = (list: string[]) => {
    const s = clean(q()).toLowerCase()
    return s ? list.filter((t) => t.toLowerCase().includes(s)) : list
  }
  const fresh = () => {
    const t = clean(q())
    return t && !known().has(t) && !props.tags.includes(t) ? t : undefined
  }
  const toggle = (t: string) => props.onToggle(t, !props.tags.includes(t))
  const mixed = (t: string) => (props.tags.includes(t) ? undefined : props.mixed?.[t])
  // 先に受けて、外側を閉じる Esc にしない
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    props.onClose()
  }
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing) return
    const t = clean(q())
    if (!t) return
    if (!props.tags.includes(t)) props.onToggle(t, true)
    setQ('')
  }
  const onOutside = (e: PointerEvent) => {
    const t = e.target
    if (t instanceof Node && !el.contains(t) && !props.anchor?.contains(t)) props.onClose()
  }
  onMount(() => {
    input.focus()
    document.addEventListener('pointerdown', onOutside)
    window.addEventListener('keydown', onKey, true)
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', onOutside)
    window.removeEventListener('keydown', onKey, true)
  })

  const grid = (list: string[]) => (
    <div class={styles.grid}>
      <For each={list}>
        {(t) => (
          <button
            type="button"
            role="checkbox"
            aria-checked={props.tags.includes(t) ? 'true' : mixed(t) ? 'mixed' : 'false'}
            data-tip={t}
            onClick={() => toggle(t)}
          >
            <span class={styles.box}>
              <Icon name={mixed(t) ? 'minus' : 'check'} size={11} />
            </span>
            <span class={styles.name}>{t}</span>
            <Show when={mixed(t)}>{(m) => <span class={styles.part}>{m()}</span>}</Show>
            {!known().has(t) && <em>新規</em>}
          </button>
        )}
      </For>
    </div>
  )

  return (
    <div
      ref={el}
      class={`${styles.root} ${props.class ?? ''}`}
      style={props.style}
      role="dialog"
      aria-label="タグを選ぶ"
    >
      <label class={styles.search}>
        <Icon name="search" size={13} withText />
        <input
          ref={input}
          type="text"
          placeholder="タグを探す・作る"
          aria-label="タグを探す・作る"
          value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={onEnter}
        />
      </label>
      <Show when={fresh()}>
        {(t) => (
          <button type="button" class={styles.fresh} onClick={() => (props.onToggle(t(), true), setQ(''))}>
            <Icon name="plus" size={13} withText />「{t()}」を新しいタグとして付ける
          </button>
        )}
      </Show>
      <section>
        <h3>おすすめ</h3>
        <Show when={props.suggested} fallback={<Spinner size={13} class={styles.wait} />}>
          {(s) => (
            <Show when={match(s()).length} fallback={<NoneText>候補はありません</NoneText>}>
              {grid(match(s()))}
            </Show>
          )}
        </Show>
      </section>
      <section>
        <h3>最近</h3>
        <Show when={match(props.recent).length} fallback={<NoneText>まだありません</NoneText>}>
          {grid(match(props.recent))}
        </Show>
      </section>
      <section class={styles.all}>
        <h3>
          すべて<em>{props.all.length}</em>
        </h3>
        <Show when={match(props.all).length} fallback={<NoneText>一致するタグはありません</NoneText>}>
          <ScrollArea class={styles.scroll}>{grid(match(props.all))}</ScrollArea>
        </Show>
      </section>
    </div>
  )
}
