import { type Accessor, type JSX, createContext, useContext } from 'solid-js'
import styles from './TabPane.module.css'

const ActiveContext = createContext<Accessor<boolean>>(() => true)

/** 中の画面が、いま表に出ているタブのものか。窓全体で受けるキー操作は、裏のタブでは受けない。 */
export const useTabActive = () => useContext(ActiveContext)

export interface TabPaneProps {
  active: boolean
  children?: JSX.Element
}

/** 1 つのタブの画面。裏に回っても消さずに隠しておき、スクロールや再生の位置を残す。 */
export function TabPane(props: TabPaneProps) {
  return (
    <ActiveContext.Provider value={() => props.active}>
      <div class={styles.root} data-active={props.active} inert={!props.active || undefined}>
        {props.children}
      </div>
    </ActiveContext.Provider>
  )
}
