import { For, type JSX, Show } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './ClipToast.module.css'

export interface ClipToastAction {
  label: string
  onClick: () => void
  danger?: boolean
  pressed?: boolean
}

export interface ClipToastProps {
  name: string
  sub: string
  danger?: boolean
  /** 左に出すサムネイル。なければ icon を出す */
  thumb?: string
  icon?: IconName
  busy?: boolean
  /** 保存中の進み具合（0〜1）。分からないときは undefined */
  progress?: number
  /** 閉じるまでの長さ（ms）。カーソルを合わせているあいだと、操作しているあいだは止まる */
  autoClose?: number
  paused?: boolean
  actions?: ClipToastAction[]
  onClose: () => void
  /** 下に広げる欄（保存先とタグの変更など） */
  children?: JSX.Element
}

/** 保存の進み具合と結果を知らせるカード。 */
export function ClipToast(props: ClipToastProps) {
  return (
    <div class={styles.root} role="status" data-paused={props.paused || undefined}>
      <div class={styles.head}>
        <div class={styles.visual} aria-hidden="true">
          <Show when={props.thumb} fallback={<Icon name={props.icon ?? 'file'} size={20} />}>
            {(src) => <img src={src()} alt="" />}
          </Show>
        </div>
        <div class={styles.text}>
          <span class={styles.name}>{props.name}</span>
          <span class={styles.sub} data-danger={props.danger || undefined}>
            {props.sub}
          </span>
        </div>
        <Show when={props.busy}>
          <Spinner size={16} class={styles.spin} />
        </Show>
        <For each={props.actions}>
          {(a) => (
            <button
              type="button"
              class={styles.act}
              data-danger={a.danger || undefined}
              aria-pressed={a.pressed}
              onClick={() => a.onClick()}
            >
              {a.label}
            </button>
          )}
        </For>
        <button type="button" class={styles.x} aria-label="閉じる" onClick={() => props.onClose()}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {props.children}
      <Show when={props.busy}>
        <div class={styles.bar} aria-hidden="true">
          <div
            class={styles.fill}
            data-unknown={props.progress === undefined || undefined}
            style={{ width: props.progress === undefined ? undefined : `${Math.round(props.progress * 100)}%` }}
          />
        </div>
      </Show>
      <Show when={!props.busy && props.autoClose} keyed>
        {(ms) => (
          <div class={styles.bar} aria-hidden="true">
            <div
              class={styles.count}
              style={{ 'animation-duration': `${ms}ms` }}
              onAnimationEnd={() => props.onClose()}
            />
          </div>
        )}
      </Show>
    </div>
  )
}
