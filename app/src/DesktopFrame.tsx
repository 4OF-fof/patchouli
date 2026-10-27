import { getCurrentWindow } from '@tauri-apps/api/window'
import { type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import icon from '../src-tauri/icons/32x32.png'
import { WindowProvider } from './components/base/TitleBar/TitleBar'

/** デスクトップの窓。OS の枠を外しているので、アプリのタイトルバーに窓のボタンを渡す。 */
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
    <WindowProvider
      value={{
        icon,
        maximized,
        onMinimize: () => void win.minimize(),
        onToggleMaximize: () => void win.toggleMaximize(),
        onClose: () => void win.close(),
      }}
    >
      {props.children}
    </WindowProvider>
  )
}
