import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import styles from './PinToggle.module.css'

export interface PinToggleProps {
  pressed?: boolean
  where?: string
  look?: 'plain' | 'float'
  /** 留めていない間は隠し、置き場所の側が --pin-show を 1 にしたときだけ出す（カードのホバーなど）。 */
  reveal?: boolean
  class?: string
  onClick?: () => void
}

export function PinToggle(props: PinToggleProps) {
  return (
    <IconButton
      class={`${styles.pin} ${props.reveal ? styles.reveal : ''} ${props.class ?? ''}`}
      look={props.look}
      label={props.pressed ? 'ピン留めを解除' : `${props.where ?? ''}ピン留めする`}
      aria-pressed={!!props.pressed}
      onClick={() => props.onClick?.()}
    >
      <Icon name="pin" class={styles.glyph} />
    </IconButton>
  )
}
