import { type Accessor, createContext, createEffect, createSignal, onCleanup, useContext } from 'solid-js'
import { useFormats } from '../../../plugins/formats'
import type { Fit } from '../../../plugins/types'
import { Icon } from '../../base/Icon/Icon'
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

/** anchor はメニューを開いたボタン。開いている間にもう一度押すと閉じる。 */
export interface MenuAt {
  x: number
  y: number
  anchor?: Element
}

export interface ItemMenuControl {
  open: (id: string, at: MenuAt) => void
  /** いま開いているメニューの anchor。 */
  anchor: Accessor<Element | undefined>
}

const Menu = createContext<ItemMenuControl>()

/** サムネイルを右クリックしたときに、素材のメニューを出す。 */
export const ItemMenuProvider = Menu.Provider
/** 素材のメニュー。画面の「その他」のボタンからも、右クリックと同じメニューを出す。 */
export const useItemMenu = () => useContext(Menu)

/** ボタンの下に出す位置。画面の右の端にはみ出すときは、メニューの右の端がボタンの右の端にそろう。 */
export const menuBelow = (e: MouseEvent & { currentTarget: HTMLElement }): MenuAt => {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.right, y: r.bottom + 4, anchor: e.currentTarget }
}

export interface ThumbProps {
  note?: boolean
  src?: string
  id?: string
  fit?: Fit
  /** 対応するプラグインがなければ、未対応の印を出す */
  ext?: string
  failed?: boolean
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
    menu.open(props.id, { x: e.clientX, y: e.clientY })
  }
  const formats = useFormats()
  const mark = () => {
    if (props.src || props.note) return undefined
    if (props.ext !== undefined && !formats().has(props.ext)) return 'unknownFile'
    return props.failed ? 'imageOff' : undefined
  }
  const waiting = () => !props.src && !props.note && !mark() && !!props.id && making(props.id)
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
      data-mark={mark()}
      onContextMenu={onContextMenu}
      style={{
        height: props.height ? `${props.height}px` : undefined,
      }}
    >
      {props.src && !props.note && (
        <img class={styles.img} src={props.src} alt="" loading="lazy" decoding="async" draggable={false} />
      )}
      {props.note && (
        <>
          {props.title && <b>{props.title}</b>}
          {props.excerpt}
        </>
      )}
      {mark() && <Icon name={mark()!} size={32} class={styles.mark} />}
      {waiting() && <Spinner class={styles.making} />}
      {props.dirty && <span class={styles.dirty} role="img" aria-label="未保存" data-tip="未保存" />}
    </span>
  )
}
