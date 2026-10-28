import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './Tooltip.module.css'

const DELAY = 500

/**
 * data-tip を持つ要素の上でしばらく止まると、その文言をカーソルの下に出す。
 * 出し方は標準の title にそろえ、見た目だけを替える。アプリに 1 つだけ置く。
 */
export function TooltipHost() {
  const [tip, setTip] = createSignal<{ text: string; x: number; y: number }>()
  let el: HTMLDivElement | undefined
  let over: Element | undefined
  let muted: Element | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let at = { x: 0, y: 0 }

  const hide = () => {
    clearTimeout(timer)
    setTip(undefined)
  }
  const onOver = (e: PointerEvent) => {
    const t = e.target instanceof Element ? (e.target.closest('[data-tip]') ?? undefined) : undefined
    at = { x: e.clientX, y: e.clientY }
    if (t === over) return
    hide()
    over = t
    if (t !== muted) muted = undefined
    if (!t || muted || e.pointerType === 'touch') return
    timer = setTimeout(() => {
      const text = t.getAttribute('data-tip')
      if (text && t.isConnected) setTip({ text, ...at })
    }, DELAY)
  }
  const onMove = (e: PointerEvent) => {
    at = { x: e.clientX, y: e.clientY }
  }
  const onOut = (e: PointerEvent) => {
    if (e.relatedTarget) return
    hide()
    over = undefined
  }
  // 押したり打ったりしたら消し、離れるまで出し直さない
  const mute = () => {
    hide()
    muted = over
  }

  onMount(() => {
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', mute, true)
    document.addEventListener('keydown', mute, true)
    document.addEventListener('wheel', mute, { capture: true, passive: true })
    window.addEventListener('blur', mute)
    onCleanup(() => {
      clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', mute, true)
      document.removeEventListener('keydown', mute, true)
      document.removeEventListener('wheel', mute, true)
      window.removeEventListener('blur', mute)
    })
  })

  createEffect(() => {
    const t = tip()
    if (!t || !el) return
    const r = el.getBoundingClientRect()
    const below = t.y + 20
    const top = below + r.height > window.innerHeight - 4 ? t.y - r.height - 4 : below
    el.style.left = `${Math.max(4, Math.min(t.x, window.innerWidth - r.width - 4))}px`
    el.style.top = `${Math.max(4, top)}px`
  })

  return (
    <Show when={tip()}>
      {(t) => (
        <Portal>
          <div ref={el} class={styles.root} role="tooltip">
            {t().text}
          </div>
        </Portal>
      )}
    </Show>
  )
}
