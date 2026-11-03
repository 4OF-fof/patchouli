import { type Accessor, type JSX, createContext, useContext } from 'solid-js'
import type { Rect } from '../SplitView/split'
import styles from './TabPane.module.css'

const ActiveContext = createContext<Accessor<boolean>>(() => true)
const ShownContext = createContext<Accessor<boolean>>(() => true)

/** 中の画面が、いま操作しているタブのものか。窓全体で受けるキー操作は、ほかのタブでは受けない。 */
export const useTabActive = () => useContext(ActiveContext)
/** 中の画面が、いま見えているか。分割したときは、操作していないペインも見えている。 */
export const useTabShown = () => useContext(ShownContext)

export interface TabPaneProps {
  active: boolean
  /** 省略したときは active と同じ。 */
  shown?: boolean
  /** 分割したときの場所。全体を 1 とした割合。 */
  rect?: Rect
  /** 分割したときに、操作しているペインに印を付ける。 */
  marked?: boolean
  onFocus?: () => void
  onContextMenu?: (e: MouseEvent) => void
  children?: JSX.Element
}

const pct = (v: number) => `${v * 100}%`

/** 1 つのタブの画面。裏に回っても消さずに隠しておき、スクロールや再生の位置を残す。 */
export function TabPane(props: TabPaneProps) {
  const shown = () => props.shown ?? props.active
  return (
    <ActiveContext.Provider value={() => props.active}>
      <ShownContext.Provider value={shown}>
        <div
          class={styles.root}
          data-active={shown()}
          data-marked={props.marked}
          inert={!shown() || undefined}
          style={
            props.rect && {
              left: pct(props.rect.x),
              top: pct(props.rect.y),
              width: pct(props.rect.w),
              height: pct(props.rect.h),
            }
          }
          on:pointerdown={{ handleEvent: () => props.onFocus?.(), capture: true }}
          onContextMenu={(e) => props.onContextMenu?.(e)}
        >
          {props.children}
        </div>
      </ShownContext.Provider>
    </ActiveContext.Provider>
  )
}
