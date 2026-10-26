import { Match, Switch } from 'solid-js'

export type IconName = 'box' | 'chevron' | 'pin'

export interface IconProps {
  name: IconName
  /** 置き場所の側で大きさや向きを決めるとき。 */
  class?: string
}

/** 16 × 16 の線のアイコン。色は文字色に合わせる。 */
export function Icon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" class={props.class} aria-hidden="true">
      <Switch>
        <Match when={props.name === 'box'}>
          <path
            d="M2.5 4.8 8 2.2l5.5 2.6v6.4L8 13.8l-5.5-2.6zM2.5 4.8 8 7.4l5.5-2.6M8 7.4v6.4"
            fill="none"
            stroke="currentColor"
            stroke-width="0.8"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.name === 'chevron'}>
          <path
            d="M6 3.5 10.5 8 6 12.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.name === 'pin'}>
          <path
            fill="currentColor"
            d="M10.2 1.5 14.5 5.8 13.4 6.9 12.6 6.5 9.9 9.2 10.3 12.3 9.2 13.4 6.5 10.7 2.7 14.5 1.5 13.3 5.3 9.5 2.6 6.8 3.7 5.7 6.8 6.1 9.5 3.4 9.1 2.6z"
          />
        </Match>
      </Switch>
    </svg>
  )
}
