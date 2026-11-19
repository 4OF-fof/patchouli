import { type Accessor, type JSX, createContext, useContext } from 'solid-js'
import { type Host, HostProvider, MAIN_HOST } from '../../../window/host'
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
  onFocus?: () => void
  onContextMenu?: (e: MouseEvent) => void
  /** 置いている窓。タブを別のウィンドウに出すと変わる。 */
  host?: () => Host
  /** 画面の上に置く段（いまの場所など）。 */
  bar?: JSX.Element
  /** bar の上に置くもの（ペインのタブ）。 */
  head?: JSX.Element
  children?: JSX.Element
}

const pct = (v: number) => `${v * 100}%`

/** 1 つのタブの画面。裏に回っても消さずに隠しておき、スクロールや再生の位置を残す。 */
export function TabPane(props: TabPaneProps) {
  const shown = () => props.shown ?? props.active
  return (
    <HostProvider value={() => props.host?.() ?? MAIN_HOST}>
      <ActiveContext.Provider value={() => props.active}>
        <ShownContext.Provider value={shown}>
          <div
            class={styles.root}
            data-active={shown()}
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
            <div class={styles.top}>
              {props.head}
              {props.bar}
            </div>
            <div class={styles.body}>{props.children}</div>
          </div>
        </ShownContext.Provider>
      </ActiveContext.Provider>
    </HostProvider>
  )
}
