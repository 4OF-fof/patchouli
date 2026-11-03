import { For, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'
import styles from './MenuResultDialog.module.css'

export interface MenuResultRow {
  label: string
  value: string
}

export interface MenuResultDialogProps {
  title: string
  rows: MenuResultRow[]
  /** 値をコピーするとき。 */
  onCopy: (value: string) => void
  onClose: () => void
}

/** プラグインの右クリックメニューの項目が返した行を並べる。 */
export function MenuResultDialog(props: MenuResultDialogProps) {
  let el!: HTMLDivElement
  const [copied, setCopied] = createSignal<number>()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))
  const copy = (i: number, value: string) => {
    props.onCopy(value)
    setCopied(i)
  }
  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={styles.frame} role="dialog" aria-label={props.title}>
        <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose()}>
          <Icon name="close" />
        </IconButton>
        <ScrollArea class={styles.root} viewClass={styles.body} tabIndex={-1} ref={el}>
          <h2>{props.title}</h2>
          <dl>
            <For each={props.rows}>
              {(r, i) => (
                <div class={styles.row}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                  <IconButton
                    class={styles.copy}
                    label={copied() === i() ? 'コピーしました' : 'コピー'}
                    onClick={() => copy(i(), r.value)}
                  >
                    <Icon name={copied() === i() ? 'check' : 'copy'} />
                  </IconButton>
                </div>
              )}
            </For>
          </dl>
        </ScrollArea>
      </div>
    </div>
  )
}
