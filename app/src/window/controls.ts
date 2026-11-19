import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Window as TauriWindow } from '@tauri-apps/api/window'
import { createSignal, onCleanup } from 'solid-js'
import type { WindowControls } from '../components/nav/TitleBar/TitleBar'

/** 次の起動でページが描かれるまでウィンドウに塗る色を覚えてもらう。 */
export function rememberBackground(color: string) {
  if (isTauri()) void invoke('set_window_background', { color })
}

/** window.open で開いた窓の label を待っているもの。デスクトップでは、開いた順に label が届く。 */
const waiting: ((label: string) => void)[] = []

/** 別のウィンドウの label を受け取り始める。窓を開く前から聞いておかないと、取りこぼす。 */
export function watchPopouts() {
  if (!isTauri()) return () => {}
  const stop = listen<string>('popout', (e) => waiting.shift()?.(e.payload))
  return () => void stop.then((f) => f())
}

/** これから window.open で開く窓の、Tauri の窓。デスクトップでなければ undefined。 */
export function nextPopout(): Promise<TauriWindow | null> | undefined {
  if (!isTauri()) return undefined
  return new Promise<string>((r) => waiting.push(r)).then((label) => TauriWindow.getByLabel(label))
}

/** 別のウィンドウの、タイトルバーに出す窓のボタンと、タイトルバーでのドラッグ。 */
export function createPopoutControls(of: Promise<TauriWindow | null>) {
  const [maximized, setMaximized] = createSignal(false)
  let w: TauriWindow | null = null
  let stopped = false
  let stop: (() => void) | undefined
  void of.then(async (x) => {
    w = x
    if (!x || stopped) return
    const check = () => void x.isMaximized().then(setMaximized)
    check()
    const un = await x.onResized(check)
    if (stopped) un()
    else stop = un
  })
  onCleanup(() => {
    stopped = true
    stop?.()
  })
  const controls: WindowControls = {
    maximized,
    onMinimize: () => void w?.minimize(),
    onToggleMaximize: () => void w?.toggleMaximize(),
    onClose: () => void w?.close(),
  }
  /** タイトルバーの何もないところを押したら窓を動かし、2 度押したら最大化を切り替える。 */
  const onDragRegion = (e: MouseEvent) => {
    if (e.button !== 0 || !(e.target instanceof Element) || !e.target.hasAttribute('data-tauri-drag-region')) return
    if (e.detail === 2) void w?.toggleMaximize()
    else void w?.startDragging()
  }
  return { controls, onDragRegion }
}
