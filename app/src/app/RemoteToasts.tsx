import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { IconName } from '../components/base/Icon/Icon'
import { Icon } from '../components/base/Icon/Icon'
import { Button } from '../components/controls/Button/Button'
import { Chip } from '../components/controls/Chip/Chip'
import { PlaceSelect } from '../components/controls/PlaceSelect/PlaceSelect'
import { TagPicker } from '../components/controls/TagPicker/TagPicker'
import { ClipToast, type ClipToastAction } from '../components/overlay/ClipToast/ClipToast'
import type { RemoteActions, RemoteToast, RemoteToastKind } from '../backend/types'
import type { Item, Library, Place } from '../model/library'
import { useTagPicker } from '../screens/useTagPicker'
import { ToastWindow, showMain } from '../window/ToastWindow'
import styles from './RemoteToasts.module.css'

/** 保存したことを知らせてから閉じるまでの長さ（ms）。 */
const AUTO_CLOSE = 6000
/** 一度に並べる数。多ければ古いものから閉じる。 */
const MAX = 3
/** 変更の欄を開いているあいだの窓の大きさ。所属とタグの一覧を窓の中に出す。 */
const EDIT_ROOM = { w: 560, h: 520 }

const ICONS: Record<RemoteToastKind, IconName> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
  file: 'file',
  url: 'link',
  note: 'note',
}

export interface RemoteToastsProps {
  lib: Library
  remote: RemoteActions
  recentTags?: string[]
  onMove: (id: string, place: Place) => void
  onTag: (id: string, tag: string, on: boolean) => void
  onOpen: (id: string) => void
  fail: (e: unknown) => void
}

const keyOf = (t: RemoteToast) => `${t.peer}:${t.key}`

/** 拡張機能などが保存したものを、画面の右下のトーストの窓で知らせる。保存先とタグは、その場で変えられる。 */
export function RemoteToasts(props: RemoteToastsProps) {
  const [toasts, setToasts] = createSignal<RemoteToast[]>([])
  const [editing, setEditing] = createSignal<string>()
  onMount(() =>
    onCleanup(
      props.remote.onToast((t) =>
        setToasts((now) => {
          const rest = now.filter((x) => keyOf(x) !== keyOf(t))
          return [...rest, t].slice(-MAX)
        }),
      ),
    ),
  )
  const close = (t: RemoteToast) => {
    if (editing() === keyOf(t)) setEditing(undefined)
    setToasts((now) => now.filter((x) => keyOf(x) !== keyOf(t)))
  }
  return (
    <Show when={toasts().length > 0}>
      <ToastWindow room={editing() ? EDIT_ROOM : undefined} onClosed={() => setToasts([])}>
        <For each={toasts()}>
          {(t) => (
            <RemoteToastCard
              {...props}
              toast={t}
              editing={editing() === keyOf(t)}
              onEdit={(on) => setEditing(on ? keyOf(t) : undefined)}
              onRetry={() => {
                close(t)
                props.remote.retryToast(t.peer, t.key).catch(props.fail)
              }}
              onClose={() => close(t)}
            />
          )}
        </For>
      </ToastWindow>
    </Show>
  )
}

function RemoteToastCard(
  props: RemoteToastsProps & {
    toast: RemoteToast
    editing: boolean
    onEdit: (on: boolean) => void
    onRetry: () => void
    onClose: () => void
  },
) {
  const item = createMemo(() => (props.toast.id ? props.lib.byId.get(props.toast.id) : undefined))
  const name = () => item()?.name ?? props.toast.name ?? ''
  const thumb = () => {
    const it = item()
    return it && !it.note && !it.waveThumb ? it.thumb : undefined
  }
  const sub = () => {
    const t = props.toast
    if (t.state === 'failed') return t.error ? `保存に失敗しました：${t.error}` : '保存に失敗しました'
    if (t.state === 'saving')
      return t.total ? `ファイルを取り込んでいます（${t.done ?? 0}/${t.total} 件）` : '保存しています'
    const it = item()
    const place = it && props.lib.placeName(it)
    return place ? `${place} に保存しました` : '保存しました'
  }
  const progress = () => {
    const t = props.toast
    return t.state === 'saving' && t.total ? (t.done ?? 0) / t.total : undefined
  }
  const actions = (): ClipToastAction[] => {
    const t = props.toast
    if (t.state === 'failed') return t.retry ? [{ label: '再試行', danger: true, onClick: props.onRetry }] : []
    const it = item()
    if (t.state !== 'saved' || !it) return []
    return [
      { label: '変更', pressed: props.editing, onClick: () => props.onEdit(!props.editing) },
      {
        label: '開く',
        onClick: () => {
          props.onClose()
          showMain()
          props.onOpen(it.id)
        },
      },
    ]
  }
  return (
    <ClipToast
      name={name()}
      sub={sub()}
      danger={props.toast.state === 'failed'}
      thumb={thumb()}
      icon={ICONS[props.toast.kind ?? (item()?.note ? 'note' : 'file')]}
      busy={props.toast.state === 'saving'}
      progress={progress()}
      autoClose={props.toast.state === 'saved' ? AUTO_CLOSE : undefined}
      paused={props.editing}
      actions={actions()}
      onClose={props.onClose}
    >
      <Show when={props.editing && item()}>{(it) => <EditPanel {...props} item={it()} />}</Show>
    </ClipToast>
  )
}

function EditPanel(props: RemoteToastsProps & { item: Item; toast: RemoteToast; onEdit: (on: boolean) => void }) {
  const picker = useTagPicker({
    lib: () => props.lib,
    recentTags: () => props.recentTags,
    reset: () => props.item.id,
  })
  const move = (to: Place) => {
    for (const id of [props.item.id, ...(props.toast.attached ?? [])]) props.onMove(id, to)
  }
  return (
    <div class={styles.edit}>
      <div class={styles.row}>
        <span class={styles.k}>保存先</span>
        <PlaceSelect class={styles.place} lib={props.lib} aria-label="保存先" value={props.item} onChange={move} />
      </div>
      <div class={styles.row}>
        <span class={`${styles.k} ${styles.top}`}>タグ</span>
        <div class={styles.tags}>
          <For each={props.item.tags}>
            {(t) => (
              <Chip removeLabel={`# ${t} を削除`} onRemove={() => props.onTag(props.item.id, t, false)}>
                # {t}
              </Chip>
            )}
          </For>
          <Chip
            ref={picker.setButton}
            dashed
            aria-expanded={picker.picking()}
            aria-haspopup="dialog"
            onClick={picker.toggle}
          >
            <Icon name="plus" size={12} withText />
            追加
          </Chip>
          <Show when={picker.picking()}>
            <TagPicker
              class={styles.picker}
              tags={props.item.tags}
              all={picker.allTags()}
              recent={picker.recent()}
              anchor={picker.button()}
              onToggle={(t, on) => props.onTag(props.item.id, t, on)}
              onClose={picker.close}
            />
          </Show>
        </div>
      </div>
      <div class={styles.done}>
        <Button variant="primary" size="sm" onClick={() => props.onEdit(false)}>
          完了
        </Button>
      </div>
    </div>
  )
}
