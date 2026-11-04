import { For, type JSX, Show, createSignal } from 'solid-js'
import { Portal } from 'solid-js/web'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Kbd } from '../../components/base/Kbd/Kbd'
import { Chip } from '../../components/controls/Chip/Chip'
import { Select } from '../../components/controls/Select/Select'
import { TagPicker } from '../../components/controls/TagPicker/TagPicker'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { type Item, type Library, type TagCandidate, thumbOf } from '../../model/library'
import { useTagPicker } from '../useTagPicker'
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
  recentTags?: string[]
  /** 名前の行の右端に置くもの */
  aside?: JSX.Element
  onTag: (tag: string, on: boolean) => void
  onProject: (name: string) => void
  onPutOff: () => void
  onApprove: () => void
}

const MIN_PICKER = 280

export function TidyPanel(props: TidyPanelProps) {
  const lib = () => props.lib
  const onTags = () => props.tags.filter((t) => t.on)
  const nothing = () => !onTags().length && !props.project
  // 選んでいない候補も、付けるか決める手がかりとして出す
  const nearTags = () =>
    [...onTags(), ...props.tags.filter((t) => !t.on)].map((t) => t.tag).filter((t) => near(t).length)
  const near = (tag: string) =>
    lib()
      .items.filter((x) => !x.note && x.id !== props.it.id && x.tags.includes(tag))
      .toSorted((a, b) => Math.abs(a.hue - props.it.hue) - Math.abs(b.hue - props.it.hue))
      .slice(0, 6)

  let picker: HTMLDivElement | undefined
  const [suggested, setSuggested] = createSignal<string[]>([])
  const [at, setAt] = createSignal<JSX.CSSProperties>({})
  /** 素材画面と同じく、押したボタンの左に、検索欄がボタンの横に来るように出す。 */
  const place = () => {
    const input = picker?.querySelector('input')
    const addBtn = button()
    if (!addBtn || !picker || !input) return
    const b = addBtn.getBoundingClientRect()
    const field = input.getBoundingClientRect()
    const offset = field.top + field.height / 2 - picker.getBoundingClientRect().top
    const top = Math.max(8, Math.min(b.top + b.height / 2 - offset, window.innerHeight - 8 - MIN_PICKER))
    setAt({
      right: `${window.innerWidth - b.left + 8}px`,
      top: `${top}px`,
      'max-height': `${window.innerHeight - top - 8}px`,
    })
  }
  const {
    picking,
    recent,
    toggle: togglePicker,
    close: closePicker,
    allTags,
    button,
    setButton,
  } = useTagPicker({
    lib,
    recentTags: () => props.recentTags,
    reset: () => props.it.id,
    onOpen: () => setSuggested(props.tags.filter((t) => t.conf).map((t) => t.tag)),
    place,
  })

  return (
    <div class={styles.root}>
      <div class={styles.nmh}>
        <b>{props.it.name}</b>
        <small>
          {props.pos} / {props.total}
          {props.later && ' | 保留中'}
        </small>
        <Show when={props.aside}>
          <span class={styles.aside}>{props.aside}</span>
        </Show>
      </div>
      <ScrollArea class={styles.scroll} viewClass={styles.body} aria-label="分類の候補">
        <div class={styles.fl}>
          <span class={styles.sub}>プロジェクト</span>
          <Select
            aria-label="プロジェクトを選択"
            value={props.project}
            options={[
              { value: '', label: '指定なし' },
              ...lib().projects.map((p) => ({ value: p.name, label: p.name })),
            ]}
            onChange={(v) => props.onProject(v)}
          />
        </div>
        <div class={styles.fl}>
          <span class={styles.sub}>タグ</span>
          <div class={styles.tags}>
            <For each={onTags()}>
              {(t) => (
                <Chip size="lg" removeLabel={`# ${t.tag} を削除`} onRemove={() => props.onTag(t.tag, false)}>
                  # {t.tag}
                </Chip>
              )}
            </For>
            <Chip
              ref={setButton}
              size="lg"
              dashed
              aria-expanded={picking()}
              aria-haspopup="dialog"
              onClick={togglePicker}
            >
              <Icon name="plus" size={14} withText />
              追加
            </Chip>
          </div>
        </div>
        <Show when={picking()}>
          <Portal>
            <TagPicker
              ref={(e) => (picker = e)}
              class={styles.picker}
              style={at()}
              tags={onTags().map((t) => t.tag)}
              all={allTags()}
              recent={recent()}
              suggested={suggested()}
              anchor={button()}
              onToggle={(t, v) => props.onTag(t, v)}
              onClose={closePicker}
            />
          </Portal>
        </Show>
        <For each={nearTags()}>
          {(tag) => (
            <div class={styles.fl}>
              <span class={styles.sub}># {tag} の類似項目</span>
              <JustifiedRow height={96} gap={6}>
                <For each={near(tag)}>
                  {(x) => (
                    <div style={{ '--ar': x.ratio }}>
                      <Thumb {...thumbOf(x)} />
                    </div>
                  )}
                </For>
              </JustifiedRow>
            </div>
          )}
        </For>
      </ScrollArea>
      <div class={styles.dec}>
        <button type="button" onClick={() => props.onPutOff()}>
          保留 <Kbd>→</Kbd>
        </button>
        <button type="button" class={styles.ok2} disabled={nothing()} onClick={() => props.onApprove()}>
          <Icon name="check" size={14} withText />
          承認 <Kbd>Enter</Kbd>
        </button>
      </div>
    </div>
  )
}
