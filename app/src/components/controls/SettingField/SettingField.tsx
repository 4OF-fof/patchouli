import { Match, Switch, createUniqueId } from 'solid-js'
import type { Setting, SettingValue } from '../../../plugins/types'
import { NumberField } from '../NumberField/NumberField'
import { Select } from '../Select/Select'
import styles from './SettingField.module.css'

export interface SettingFieldProps {
  setting: Setting
  /** 返した Promise が終わったら、渡された value に描き直す（変えられなかったときに、押した見た目のまま残さないため） */
  onChange?: (value: SettingValue) => void | Promise<unknown>
  disabled?: boolean
}

export function SettingField(props: SettingFieldProps) {
  const id = createUniqueId()
  const s = () => props.setting
  const range = () => {
    const x = s()
    return x.kind === 'number' ? x : undefined
  }
  const change = (v: SettingValue, sync: () => void) => void Promise.resolve(props.onChange?.(v)).finally(sync)
  const choices = () => {
    const x = s()
    return x.kind === 'choice' ? x.choices : []
  }
  return (
    <div class={styles.root}>
      <div class={styles.text}>
        <label class={styles.label} for={id}>
          {s().label}
        </label>
        {s().help && <p class={styles.help}>{s().help}</p>}
      </div>
      <Switch>
        <Match when={s().kind === 'toggle'}>
          <input
            id={id}
            class={styles.toggle}
            type="checkbox"
            checked={s().value === true}
            disabled={props.disabled}
            onChange={(e) => {
              const el = e.currentTarget
              change(el.checked, () => (el.checked = s().value === true))
            }}
          />
        </Match>
        <Match when={range()}>
          {(r) => (
            <NumberField
              id={id}
              value={Number(r().value)}
              min={r().min ?? undefined}
              max={r().max ?? undefined}
              step={r().step ?? undefined}
              disabled={props.disabled}
              onChange={props.onChange}
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
            onChange={(e) => {
              const el = e.currentTarget
              change(el.value, () => (el.value = String(s().value)))
            }}
          />
        </Match>
        <Match when={s().kind === 'choice'}>
          <Select
            id={id}
            class={styles.choice}
            value={String(s().value)}
            options={choices()}
            disabled={props.disabled}
            onChange={(v) => props.onChange?.(v)}
          />
        </Match>
      </Switch>
    </div>
  )
}
