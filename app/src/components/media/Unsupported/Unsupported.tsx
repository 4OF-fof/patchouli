import { Show } from 'solid-js'
import type { PluginStatus } from '../../../plugins/types'
import { Icon } from '../../base/Icon/Icon'
import { Button } from '../../controls/Button/Button'
import { createBusy } from '../../../model/busy'
import styles from './Unsupported.module.css'

/** conflict は、同じ形式に対応していて、どれも使っていないプラグインの名前。 */
export type Blocker = Pick<PluginStatus, 'id' | 'name' | 'dev' | 'state'> & { conflict?: string[] }

export interface UnsupportedProps {
  name: string
  ext: string
  label: string
  blocker?: Blocker
  /** プラグインはあるが、この環境のデコーダーで中身を読めなかった */
  decoder?: boolean
  onEnable?: (p: Blocker) => Promise<void>
  onOpenPlugins?: (p?: Blocker) => void
  onReveal?: () => Promise<void>
  onOpenDefault?: () => Promise<void>
  class?: string
}

export function Unsupported(props: UnsupportedProps) {
  const { busy: working, error, run: start } = createBusy()
  const busy = () => working() !== undefined
  const run = (job: () => Promise<void>) => start('', job)
  const text = () => {
    if (props.decoder) return 'このファイルの形式（コーデック）にこの環境が対応していないため、表示できません'
    const b = props.blocker
    if (!b) return `${props.label ? `${props.label} ` : 'このファイル'}に対応したプラグインがありません`
    if (b.conflict)
      return `複数のプラグイン（${b.conflict.map((n) => `「${n}」`).join('')}）がこの形式に対応しているため、表示できません`
    return b.state === 'disabled'
      ? `プラグイン「${b.name}」が無効のため、表示できません`
      : `プラグイン「${b.name}」を使用できないため、表示できません`
  }
  const enable = () => {
    const b = props.blocker
    const on = props.onEnable
    return b?.state === 'disabled' && on ? () => run(() => on(b)) : undefined
  }
  return (
    <div class={`${styles.root} ${props.class ?? ''}`} role="status">
      <Icon name="unknownFile" size={72} class={styles.icon} />
      <b class={styles.name}>
        {props.name}
        <Show when={props.ext}>.{props.ext}</Show>
      </b>
      <p class={styles.text}>{text()}</p>
      <div class={styles.actions}>
        <Show when={enable()}>
          {(go) => (
            <Button variant="primary" disabled={busy()} onClick={() => void go()()}>
              有効化
            </Button>
          )}
        </Show>
        <Show when={!props.decoder && props.onOpenPlugins}>
          {(open) => (
            <Button
              variant={props.blocker && !enable() ? 'primary' : 'default'}
              disabled={busy()}
              onClick={() => open()(props.blocker)}
            >
              {props.blocker ? 'プラグインを開く' : 'プラグインを探す'}
            </Button>
          )}
        </Show>
        <Show when={!props.blocker && props.onReveal}>
          {(reveal) => (
            <Button disabled={busy()} onClick={() => void run(reveal())}>
              フォルダを開く
            </Button>
          )}
        </Show>
        <Show when={props.onOpenDefault}>
          {(open) => (
            <Button disabled={busy()} onClick={() => void run(open())}>
              既定のアプリで開く
            </Button>
          )}
        </Show>
      </div>
      <Show when={error()}>
        <p class={styles.error} role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
