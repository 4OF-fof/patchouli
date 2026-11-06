/* @refresh reload */
import { isTauri } from '@tauri-apps/api/core'
import type { JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { App } from './App'
import { DesktopFrame } from './DesktopFrame'
import { TooltipHost } from './components/overlay/Tooltip/Tooltip'
import { type Opened, pickBackend } from './backend'
import { applyPrefs, prefs } from './model/prefs'
import { LibraryErrorScreen } from './screens/LibraryError/LibraryErrorScreen'
import './index.css'

const root = document.getElementById('root')!

openMain()

function show(main: () => JSX.Element) {
  render(
    () => (
      <>
        {isTauri() ? <DesktopFrame>{main()}</DesktopFrame> : main()}
        <TooltipHost />
      </>
    ),
    root,
  )
}

function openMain() {
  const backend = pickBackend()
  void backend.open().then(
    (o: Opened) => {
      if (o.problems.length) console.warn('読めなかったもの', o.problems)
      const notice = o.problems.length ? `${o.problems.length} 件を読み込めませんでした` : undefined
      show(() => <App {...o} notice={notice} backend={backend} />)
    },
    // 開けていないライブラリに書き込もうとしないよう、アプリは出さない
    (e: unknown) => {
      applyPrefs(prefs())
      show(() => (
        <LibraryErrorScreen
          reason={e instanceof Error ? e.message : String(e)}
          libraries={backend.libraries}
          onChoose={backend.chooseLibrary && (() => backend.chooseLibrary!())}
          onReopen={() => window.location.reload()}
        />
      ))
    },
  )
}
