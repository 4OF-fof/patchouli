import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { ProgressBar } from '../../base/ProgressBar/ProgressBar'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './ActivityButton.module.css'

export interface Activity {
  key: string
  icon: IconName
  label: string
  done?: number
  total?: number
  onStop?: () => void
}

export interface ActivityButtonProps {
  activities: Activity[]
  open?: boolean
}

export function ActivityButton(props: ActivityButtonProps) {
  const [open, setOpen] = createSignal(!!props.open)
  const [stopping, setStopping] = createSignal<ReadonlySet<string>>(new Set())
  const busy = () => props.activities.length > 0
  createEffect(() => {
    const keys = new Set(props.activities.map((a) => a.key))
    const left = [...stopping()].filter((k) => keys.has(k))
    if (left.length !== stopping().size) setStopping(new Set(left))
    if (!keys.size) setOpen(false)
  })
  const stop = (a: Activity) => {
    setStopping(new Set([...stopping(), a.key]))
    a.onStop?.()
  }

  let el!: HTMLDivElement
  const away = (e: PointerEvent) => {
    if (e.target instanceof Node && !el.contains(e.target)) setOpen(false)
  }
  createEffect(() => {
    if (!open()) return
    document.addEventListener('pointerdown', away)
    onCleanup(() => document.removeEventListener('pointerdown', away))
  })

  return (
    <div class={styles.root} ref={el}>
      <Show when={busy()}>
        <button
          type="button"
          class={styles.button}
          aria-label="処理中"
          title="処理中"
          aria-haspopup="dialog"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <Spinner />
        </button>
      </Show>
      <Show when={busy() && open()}>
        <div class={styles.panel} role="dialog" aria-label="処理中">
          <div class={styles.head}>処理中</div>
          <For each={props.activities}>
            {(a) => (
              <div class={styles.row}>
                <Icon name={a.icon} size={14} class={styles.icon} />
                <span class={styles.label}>{a.label}</span>
                <Show when={a.total}>
                  {(total) => (
                    <span class={styles.num}>
                      {a.done ?? 0} / {total()}
                    </span>
                  )}
                </Show>
                <Show when={a.onStop}>
                  <button
                    type="button"
                    class={styles.stop}
                    title={stopping().has(a.key) ? '止めています' : '止める'}
                    aria-label={stopping().has(a.key) ? '止めています' : '止める'}
                    disabled={stopping().has(a.key)}
                    onClick={() => stop(a)}
                  >
                    <Icon name="stop" size={14} />
                  </button>
                </Show>
                <Show when={a.total}>
                  {(total) => <ProgressBar class={styles.bar} value={(a.done ?? 0) / total()} />}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
