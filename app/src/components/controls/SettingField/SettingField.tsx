import { For, Match, Switch, createUniqueId } from 'solid-js'
import type { Setting, SettingValue } from '../../../plugins/types'
import styles from './SettingField.module.css'

export interface SettingFieldProps {
  /** プラグインが返した記述。 */
  setting: Setting
  /** 値を変えたとき。文字は入力を終えたときに呼ぶ。 */
  onChange?: (value: SettingValue) => void
  disabled?: boolean
}

/** プラグインの設定の項目を 1 つ描く。プラグインは記述だけを返し、この部品が描く。 */
export function SettingField(props: SettingFieldProps) {
  const id = createUniqueId()
  const s = () => props.setting
  const range = () => {
    const x = s()
    return x.kind === 'number' ? x : undefined
  }
  const choices = () => {
    const x = s()
    return x.kind === 'choice' ? x.choices : []
  }
  const num = (v: string) => {
    const n = Number(v)
    if (v.trim() !== '' && Number.isFinite(n)) props.onChange?.(n)
  }
  return (
    <div class={styles.root}>
      <label class={styles.label} for={id}>
        {s().label}
      </label>
      <Switch>
        <Match when={s().kind === 'toggle'}>
          <input
            id={id}
            class={styles.toggle}
            type="checkbox"
            checked={s().value === true}
            disabled={props.disabled}
            onChange={(e) => props.onChange?.(e.currentTarget.checked)}
          />
        </Match>
        <Match when={range()}>
          {(r) => (
            <input
              id={id}
              class={`${styles.input} ${styles.number}`}
              type="number"
              value={String(r().value)}
              min={r().min ?? undefined}
              max={r().max ?? undefined}
              step={r().step ?? 'any'}
              disabled={props.disabled}
              onChange={(e) => num(e.currentTarget.value)}
            />
          )}
        </Match>
        <Match when={s().kind === 'text'}>
          <input
            id={id}
            class={styles.input}
            type="text"
            value={String(s().value)}
            disabled={props.disabled}
            onChange={(e) => props.onChange?.(e.currentTarget.value)}
          />
        </Match>
        <Match when={s().kind === 'choice'}>
          <select
            id={id}
            class={styles.input}
            value={String(s().value)}
            disabled={props.disabled}
            onChange={(e) => props.onChange?.(e.currentTarget.value)}
          >
            <For each={choices()}>{(o) => <option value={o.value}>{o.label}</option>}</For>
          </select>
        </Match>
      </Switch>
      {s().help && <p class={styles.help}>{s().help}</p>}
    </div>
  )
}
