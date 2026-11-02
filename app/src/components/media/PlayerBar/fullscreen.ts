import { createSignal, onCleanup, onMount } from 'solid-js'

/** target を全画面にする切り替えと、いま全画面かどうか。 */
export function useFullscreen(target: () => HTMLElement | undefined) {
  const [full, setFull] = createSignal(!!document.fullscreenElement)
  const sync = () => setFull(!!document.fullscreenElement)
  onMount(() => document.addEventListener('fullscreenchange', sync))
  onCleanup(() => document.removeEventListener('fullscreenchange', sync))
  const toggle = () => {
    const el = target()
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => undefined)
  }
  return { full, toggle }
}
