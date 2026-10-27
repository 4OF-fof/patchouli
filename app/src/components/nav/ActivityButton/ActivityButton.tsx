import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import { Icon, type IconName } from '../../base/Icon/Icon'
import { ProgressBar } from '../../base/ProgressBar/ProgressBar'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './ActivityButton.module.css'

/** 裏で動いている処理の 1 つ。total があれば、done と合わせて進み具合を出す。 */
export interface Activity {
  key: string
  icon: IconName
  label: string
  done?: number
  total?: number
}

export interface ActivityButtonProps {
  activities: Activity[]
  /** 最初から一覧を開いておく（見本）。 */
  open?: boolean
}

/** 終わったことを知らせておく長さ。 */
const DONE_MS = 3000

/** 裏で処理が動いているあいだ、回る印と処理の数を出す。押すと処理の一覧を開き、すべて終わると少しのあいだ「完了」を出す。 */
export function ActivityButton(props: ActivityButtonProps) {
  const [open, setOpen] = createSignal(!!props.open)
  const [done, setDone] = createSignal(false)
  const busy = () => props.activities.length > 0
  createEffect(
    on(busy, (now, before) => {
      if (now) {
        setDone(false)
        return
      }
      setOpen(false)
      if (!before) return
      setDone(true)
      const t = window.setTimeout(() => setDone(false), DONE_MS)
      onCleanup(() => clearTimeout(t))
    }),
  )

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
          aria-label={`処理中 ${props.activities.length} 件`}
          title="裏で動いている処理"
          aria-haspopup="dialog"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <Spinner />
          <span class={styles.count}>{props.activities.length}</span>
        </button>
      </Show>
      <Show when={!busy() && done()}>
        <span class={styles.done} role="status">
          <Icon name="check" size={14} />
          完了
        </span>
      </Show>
      <Show when={busy() && open()}>
        <div class={styles.panel} role="dialog" aria-label="裏で動いている処理">
          <div class={styles.head}>裏で動いている処理</div>
          <For each={props.activities}>
            {(a) => (
              <div class={styles.row}>
                <Icon name={a.icon} size={14} class={styles.icon} />
                <span class={styles.label}>{a.label}</span>
                <Show when={a.total}>
                  {(total) => (
                    <>
                      <span class={styles.num}>
                        {a.done ?? 0} / {total()}
                      </span>
                      <ProgressBar class={styles.bar} value={(a.done ?? 0) / total()} />
                    </>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
