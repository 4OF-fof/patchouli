import { Show, createSignal } from 'solid-js'
import type { PluginStatus } from '../../../plugins/types'
import { Icon } from '../../base/Icon/Icon'
import { Button } from '../../controls/Button/Button'
import styles from './Unsupported.module.css'

/** 形式を受け持つはずが、使えないプラグイン。 */
export type Blocker = Pick<PluginStatus, 'id' | 'name' | 'dev' | 'state'>

export interface UnsupportedProps {
  /** ファイルの名前（拡張子なし）。 */
  name: string
  /** 拡張子（「.」なし）。 */
  ext: string
  /** 形式の呼び名。 */
  label: string
  /** わかっていれば、表示できない理由のプラグイン。 */
  blocker?: Blocker
  /** 渡さない操作のボタンは出さない。 */
  onEnable?: (p: Blocker) => Promise<void>
  /** プラグインの一覧を開く。p があれば、それを選んでおく。 */
  onOpenPlugins?: (p?: Blocker) => void
  onReveal?: () => Promise<void>
  onOpenDefault?: () => Promise<void>
  class?: string
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 対応するプラグインがない素材の、詳細の代わり。ファイル名と理由、ほかで開く操作を出す。暗い舞台の上に置く。 */
export function Unsupported(props: UnsupportedProps) {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await job()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const text = () => {
    const b = props.blocker
    if (!b) return `${props.label ? `${props.label} ` : 'このファイル'}に対応したプラグインがありません`
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
        <Show when={props.onOpenPlugins}>
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
