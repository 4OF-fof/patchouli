import { Show, createSignal } from 'solid-js'
import type { Library, Place } from '../../../model/library'
import { Icon } from '../../base/Icon/Icon'
import { PlaceMenu } from '../../nav/PlaceMenu/PlaceMenu'
import { ContextMenu } from '../../overlay/ContextMenu/ContextMenu'
import styles from './PlaceSelect.module.css'

export interface PlaceSelectProps {
  lib: Library
  value: Place
  onChange?: (place: Place) => void
  'aria-label'?: string
  class?: string
}

/** 所属を選ぶ。一覧は階層をたどる。 */
export function PlaceSelect(props: PlaceSelectProps) {
  let button!: HTMLButtonElement
  const [at, setAt] = createSignal<{ x: number; y: number }>()
  const close = () => {
    setAt(undefined)
    button.focus()
  }
  const open = () => {
    const r = button.getBoundingClientRect()
    setAt({ x: r.left, y: r.bottom + 4 })
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        class={`${styles.root} ${props.class ?? ''}`}
        aria-label={props['aria-label']}
        aria-haspopup="menu"
        aria-expanded={!!at()}
        onClick={() => (at() ? close() : open())}
      >
        <span class={styles.value}>{props.lib.placeName(props.value) ?? '所属なし'}</span>
        <Icon name="chevron" size={12} class={styles.chevron} withText />
      </button>
      <Show when={at()}>
        {(p) => (
          <ContextMenu x={p().x} y={p().y} onClose={close}>
            <PlaceMenu
              lib={props.lib}
              title={props['aria-label'] ?? '所属'}
              current={props.value}
              onBack={close}
              onClose={close}
              focusFirst
              onPick={(to) => {
                close()
                props.onChange?.(to)
              }}
            />
          </ContextMenu>
        )}
      </Show>
    </>
  )
}
