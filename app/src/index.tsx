/* @refresh reload */
import { isTauri } from '@tauri-apps/api/core'
import { render } from 'solid-js/web'
import { App } from './App'
import { DesktopFrame } from './DesktopFrame'
import { type Opened, pickBackend } from './backend'
import { buildLibrary } from './model/library'
import './index.css'

const backend = pickBackend()
const root = document.getElementById('root')!

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
    render(() => {
      const app = <App {...o} backend={backend} />
      return isTauri() ? <DesktopFrame>{app}</DesktopFrame> : app
    }, root),
  )
