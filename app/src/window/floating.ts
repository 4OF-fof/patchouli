import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * 窓の外にも出せる、カーソルに付けて動かす小さな窓。デスクトップでだけ使え、ほかでは undefined。
 * page は public/ghost.html の # の後ろに付けるもので、初めて出すときに作る。位置は画面の上の位置で、動かすのは描くたびに 1 度にまとめる
 */
export function floating(page: () => string, w: number, h: number) {
  if (!isTauri()) return undefined
  let shown = false
  let frame = 0
  let at = { x: 0, y: 0 }
  const send = () => {
    frame = 0
    void invoke('ghost_move', at).catch(() => {})
  }
  return {
    show: (x: number, y: number) => {
      at = { x, y }
      if (shown) {
        frame ||= requestAnimationFrame(send)
        return
      }
      shown = true
      void invoke('ghost_show', { page: page(), x, y, w, h }).catch(() => {})
    },
    hide: () => {
      if (!shown) return
      shown = false
      cancelAnimationFrame(frame)
      frame = 0
      void invoke('ghost_hide').catch(() => {})
    },
  }
}
