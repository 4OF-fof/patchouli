import { Icon } from '../../base/Icon/Icon'
import styles from './NumberField.module.css'

export interface NumberFieldProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange?: (value: number) => void
  id?: string
  'aria-label'?: string
  disabled?: boolean
  class?: string
}

const decimals = (n: number) => (String(n).split('.')[1] ?? '').length

export function NumberField(props: NumberFieldProps) {
  let input!: HTMLInputElement
  const step = () => props.step ?? 1
  const clamp = (n: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n))
  const set = (n: number) => {
    const v = clamp(n)
    input.value = String(v)
    if (v !== props.value) props.onChange?.(v)
  }
  const bump = (dir: 1 | -1) =>
    set(Number((props.value + dir * step()).toFixed(Math.max(decimals(step()), decimals(props.value)))))
  const commit = () => {
    const t = input.value.trim()
    const n = Number(t)
    if (t === '' || !Number.isFinite(n)) input.value = String(props.value)
    else set(n)
  }
  return (
    <span class={`${styles.root} ${props.class ?? ''}`} data-disabled={props.disabled}>
      <button
        type="button"
        class={styles.step}
        tabIndex={-1}
        aria-label="減らす"
        data-tip="減らす"
        disabled={props.disabled || props.value <= (props.min ?? -Infinity)}
        onClick={() => bump(-1)}
      >
        <Icon name="minus" size={12} />
      </button>
      <input
        ref={input}
        id={props.id}
        class={styles.input}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={props['aria-label']}
        aria-valuenow={props.value}
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        value={String(props.value)}
        disabled={props.disabled}
        onChange={commit}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            bump(e.key === 'ArrowUp' ? 1 : -1)
          } else if (e.key === 'Enter') commit()
        }}
      />
      <button
        type="button"
        class={styles.step}
        tabIndex={-1}
        aria-label="増やす"
        data-tip="増やす"
        disabled={props.disabled || props.value >= (props.max ?? Infinity)}
        onClick={() => bump(1)}
      >
        <Icon name="plus" size={12} />
      </button>
    </span>
  )
}
