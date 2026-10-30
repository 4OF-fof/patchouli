import { createContext, createEffect, createSignal, onCleanup, useContext } from 'solid-js'
import type { Fit } from '../../../plugins/types'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './Thumb.module.css'

const Making = createContext<(id: string) => boolean>(() => false)

export const ThumbMakingProvider = Making.Provider

type Watch = (id: string, el: Element) => () => void

const Seen = createContext<Watch>()

/** 作成待ちのサムネイルのうち、画面に見えているものを知らせる。 */
export const ThumbSeenProvider = Seen.Provider

/** 見えている作成待ちの ID が変わるたびに、onChange に渡す。ThumbSeenProvider の value にする。 */
export function watchSeen(onChange: (ids: string[]) => void): Watch {
  const ids = new Map<Element, string>()
  const seen = new Set<Element>()
  let timer = 0
  const tell = () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => onChange([...new Set([...seen].flatMap((el) => ids.get(el) ?? []))]), 100)
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) seen.add(e.target)
      else seen.delete(e.target)
    }
    tell()
  })
  return (id, el) => {
    ids.set(el, id)
    io.observe(el)
    return () => {
      io.unobserve(el)
      ids.delete(el)
      if (seen.delete(el)) tell()
    }
  }
}

const Menu = createContext<(id: string, at: { x: number; y: number }) => void>()

/** サムネイルを右クリックしたときに、素材のメニューを出す。 */
export const ItemMenuProvider = Menu.Provider

export interface ThumbProps {
  note?: boolean
  hue?: number
  sat?: number
  src?: string
  id?: string
  fit?: Fit
  title?: string
  excerpt?: string
  height?: number
  selected?: boolean
  dirty?: boolean
  /** false なら、右クリックしてもメニューを出さない。 */
  menu?: boolean
  class?: string
}

export function Thumb(props: ThumbProps) {
  const making = useContext(Making)
  const menu = useContext(Menu)
  const onContextMenu = (e: MouseEvent) => {
    if (!menu || !props.id || props.menu === false) return
    e.preventDefault()
    e.stopPropagation()
    menu(props.id, { x: e.clientX, y: e.clientY })
  }
  const waiting = () => !props.src && !props.note && !!props.id && making(props.id)
  const watch = useContext(Seen)
  const [el, setEl] = createSignal<HTMLElement>()
  createEffect(() => {
    const e = el()
    const id = props.id
    if (watch && e && id && waiting()) onCleanup(watch(id, e))
  })
  return (
    <span
      ref={setEl}
      class={`${styles.root} ${props.class ?? ''}`}
      data-note={!!props.note}
      data-fit={props.src ? (props.fit ?? 'center') : undefined}
      data-selected={props.selected}
      onContextMenu={onContextMenu}
      style={{
        '--h': props.hue ?? 210,
        '--s': props.sat != null ? `${props.sat}%` : undefined,
        height: props.height ? `${props.height}px` : undefined,
        'background-image': props.src ? `url(${props.src})` : undefined,
      }}
    >
      {props.note && (
        <>
          {props.title && <b>{props.title}</b>}
          {props.excerpt}
        </>
      )}
      {waiting() && <Spinner class={styles.making} />}
      {props.dirty && <span class={styles.dirty} role="img" aria-label="未保存" data-tip="未保存" />}
    </span>
  )
}
