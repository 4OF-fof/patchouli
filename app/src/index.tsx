/* @refresh reload */
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { render } from 'solid-js/web'
import { App } from './App'
import { DesktopFrame } from './DesktopFrame'
import { TooltipHost } from './components/overlay/Tooltip/Tooltip'
import { type Opened, pickBackend } from './backend'
import { buildLibrary } from './model/library'
import { SCREEN_WINDOW } from './window/protocol'
import { ScreenWindow } from './window/ScreenWindow'
import './index.css'

const root = document.getElementById('root')!

if (isTauri() && getCurrentWebviewWindow().label.startsWith(SCREEN_WINDOW))
  render(
    () => (
      <>
        <ScreenWindow />
        <TooltipHost />
      </>
    ),
    root,
  )
else openMain()

function openMain() {
  const backend = pickBackend()
  void backend
    .open()
    .then(
      (o: Opened) => {
        if (o.problems.length) console.warn('読めなかったもの', o.problems)
        return { ...o, notice: o.problems.length ? `${o.problems.length} 件を読み込めませんでした` : undefined }
      },
      (e: unknown) => ({
        lib: buildLibrary([], [], new Date()),
        pinnedProjects: [],
        pinnedTags: [],
        notice: `ライブラリを開けませんでした：${e instanceof Error ? e.message : String(e)}`,
      }),
    )
    .then((o) =>
      render(
        () => (
          <>
            {isTauri() ? (
              <DesktopFrame>
                <App {...o} backend={backend} />
              </DesktopFrame>
            ) : (
              <App {...o} backend={backend} />
            )}
            <TooltipHost />
          </>
        ),
        root,
      ),
    )
}
