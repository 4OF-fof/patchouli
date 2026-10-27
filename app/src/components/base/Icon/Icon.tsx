import { Match, Switch } from 'solid-js'

export type IconName = 'box' | 'chevron' | 'pin' | 'play' | 'pause' | 'volume' | 'muted' | 'fullscreen' | 'unfullscreen'

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
        <Match when={props.name === 'play'}>
          <path fill="currentColor" d="M4.5 2.6v10.8L13.2 8z" />
        </Match>
        <Match when={props.name === 'pause'}>
          <path fill="currentColor" d="M4 2.8h2.7v10.4H4zM9.3 2.8H12v10.4H9.3z" />
        </Match>
        <Match when={props.name === 'volume'}>
          <path fill="currentColor" d="M1.8 5.9h2.6L7.8 3v10l-3.4-2.9H1.8z" />
          <path
            d="M10.2 5.6a3.4 3.4 0 0 1 0 4.8M12.1 3.7a6.1 6.1 0 0 1 0 8.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.name === 'muted'}>
          <path fill="currentColor" d="M1.8 5.9h2.6L7.8 3v10l-3.4-2.9H1.8z" />
          <path
            d="M10.3 6.1l3.8 3.8M14.1 6.1l-3.8 3.8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.name === 'fullscreen'}>
          <path
            d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.name === 'unfullscreen'}>
          <path
            d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
      </Switch>
    </svg>
  )
}
