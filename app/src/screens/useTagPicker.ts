import { createEffect, createSignal, on } from 'solid-js'
import type { Library } from '../model/library'

/**
 * タグを付ける欄の開け閉め。開くボタンは setButton で受け取る。
 * reset が変わったら閉じる。place があれば、開いたあとに位置を合わせる。
 */
export function useTagPicker(o: {
  lib: () => Library
  recentTags: () => string[] | undefined
  reset: () => unknown
  onOpen?: () => void
  place?: () => void
}) {
  let button: HTMLButtonElement | undefined
  const [picking, setPicking] = createSignal(false)
  // 付けるたびに並びが変わらないよう、開いたときのものを使う
  const [recent, setRecent] = createSignal<string[]>([])
  const toggle = () => {
    if (picking()) {
      setPicking(false)
      return
    }
    setRecent(o.recentTags() ?? [])
    o.onOpen?.()
    setPicking(true)
    o.place?.()
  }
  const close = () => {
    setPicking(false)
    button?.focus()
  }
  createEffect(on(o.reset, () => setPicking(false), { defer: true }))
  const allTags = () => [...o.lib().tagGroups().keys()].toSorted((x, y) => x.localeCompare(y, 'ja'))
  return {
    picking,
    recent,
    toggle,
    close,
    allTags,
    button: () => button,
    setButton: (el: HTMLButtonElement) => (button = el),
  }
}
