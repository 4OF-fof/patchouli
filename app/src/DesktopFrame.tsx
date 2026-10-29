import { getCurrentWindow } from '@tauri-apps/api/window'
import { type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import { WindowProvider } from './components/nav/TitleBar/TitleBar'

/** WebView の標準のメニューは出さない。サムネイルの上では、アプリのメニューを出す。 */
const noMenu = (e: MouseEvent) => e.preventDefault()

/** デスクトップの窓。OS の枠を外しているので、アプリのタイトルバーに窓のボタンを渡す。 */
export function DesktopFrame(props: { children: JSX.Element }) {
  const win = getCurrentWindow()
  const [maximized, setMaximized] = createSignal(false)
  const check = () => void win.isMaximized().then(setMaximized)
  onMount(() => {
    check()
    const stop = win.onResized(check)
    document.addEventListener('contextmenu', noMenu)
    onCleanup(() => {
      void stop.then((f) => f())
      document.removeEventListener('contextmenu', noMenu)
    })
  })
  return (
    <WindowProvider
      value={{
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
