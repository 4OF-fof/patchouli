import { getCurrentWindow } from '@tauri-apps/api/window'
import { type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import icon from '../src-tauri/icons/32x32.png'
import { TitleBar } from './components/base/TitleBar/TitleBar'
import styles from './DesktopFrame.module.css'

/** デスクトップの窓。OS の枠を外しているので、自前のタイトルバーを上に置く。 */
export function DesktopFrame(props: { children: JSX.Element }) {
  const win = getCurrentWindow()
  const [maximized, setMaximized] = createSignal(false)
  const check = () => void win.isMaximized().then(setMaximized)
  onMount(() => {
    check()
    const stop = win.onResized(check)
    onCleanup(() => void stop.then((f) => f()))
  })
  return (
    <div class={styles.root}>
      <TitleBar
        icon={icon}
        maximized={maximized()}
        onMinimize={() => void win.minimize()}
        onToggleMaximize={() => void win.toggleMaximize()}
        onClose={() => void win.close()}
      />
      {props.children}
    </div>
  )
}
