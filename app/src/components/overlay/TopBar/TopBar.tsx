import type { JSX } from 'solid-js'
import { FloatingPill } from '../../controls/FloatingPill/FloatingPill'
import styles from './TopBar.module.css'

export interface TopBarProps {
  backLabel?: string
  onBack?: () => void
  /** 置き場所の側で、消え方や重なりの順（--top-bar-z）を決めるとき。 */
  class?: string
  /** 戻るの右に並べるもの（名前など）。 */
  children?: JSX.Element
  /** ⋯ の左に並べる操作。 */
  actions?: JSX.Element
}

/** ノートや素材の上に浮かべる帯。左に戻る、右に ⋯。 */
export function TopBar(props: TopBarProps) {
  return (
    <div class={`${styles.root} ${props.class ?? ''}`}>
      <FloatingPill onClick={() => props.onBack?.()}>‹ {props.backLabel ?? 'ホーム'}</FloatingPill>
      {props.children}
      <span class={styles.sp} />
      {props.actions}
      <FloatingPill icon aria-label="その他">
        ⋯
      </FloatingPill>
    </div>
  )
}
