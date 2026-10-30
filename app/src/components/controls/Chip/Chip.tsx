import { type JSX, Show, splitProps } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
import styles from './Chip.module.css'

export interface ChipProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  dashed?: boolean
  removeLabel?: string
  onRemove?: () => void
}

export function Chip(props: ChipProps) {
  const [local, rest] = splitProps(props, ['dashed', 'class', 'children', 'removeLabel', 'onRemove'])
  return (
    <Show
      when={local.onRemove}
      fallback={
        <button type="button" class={`${styles.root} ${local.class ?? ''}`} data-dashed={local.dashed} {...rest}>
          {local.children}
        </button>
      }
    >
      {(remove) => (
        <span class={`${styles.root} ${styles.split} ${local.class ?? ''}`}>
          <button type="button" class={styles.main} {...rest}>
            {local.children}
          </button>
          <button
            type="button"
            class={styles.remove}
            aria-label={local.removeLabel}
            data-tip={local.removeLabel}
            onClick={() => remove()()}
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      )}
    </Show>
  )
}
