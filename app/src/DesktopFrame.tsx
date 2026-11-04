import { getCurrentWindow } from '@tauri-apps/api/window'
import { type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import { WindowProvider } from './components/nav/TitleBar/TitleBar'
import { flush } from './model/persist'

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
    // 待っている書き込みを終えてから閉じる。ハンドラが終わると、窓が閉じる
    const closing = win.onCloseRequested(() => flush())
    document.addEventListener('contextmenu', noMenu)
    onCleanup(() => {
      void stop.then((f) => f())
      void closing.then((f) => f())
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
