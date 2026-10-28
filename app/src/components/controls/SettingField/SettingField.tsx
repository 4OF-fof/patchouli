import { Match, Switch, createUniqueId } from 'solid-js'
import type { Setting, SettingValue } from '../../../plugins/types'
import { NumberField } from '../NumberField/NumberField'
import { Select } from '../Select/Select'
import styles from './SettingField.module.css'

export interface SettingFieldProps {
  setting: Setting
  onChange?: (value: SettingValue) => void
  disabled?: boolean
}

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
            <NumberField
              id={id}
              value={Number(r().value)}
              min={r().min ?? undefined}
              max={r().max ?? undefined}
              step={r().step ?? undefined}
              disabled={props.disabled}
              onChange={(n) => props.onChange?.(n)}
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
      {s().help && <p class={styles.help}>{s().help}</p>}
    </div>
  )
}
