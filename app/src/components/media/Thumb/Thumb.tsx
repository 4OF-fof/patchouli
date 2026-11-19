import { type Accessor, Show, createContext, createEffect, createSignal, onCleanup, useContext } from 'solid-js'
import { useFormats } from '../../../plugins/formats'
import type { Fit } from '../../../plugins/types'
import { Icon, type IconName } from '../../base/Icon/Icon'
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
  /** 形式によらず出す印 */
  mark?: 'lock' | 'note'
  /** src はサイトアイコン。カードいっぱいに広げない */
  icon?: boolean
  /** ショートカットのアイコンの下に出す種類名。なければ拡張子 */
  label?: string
  title?: string
  excerpt?: string
  height?: number
  selected?: boolean
  dirty?: boolean
  /** false なら、右クリックしてもメニューを出さない。 */
  menu?: boolean
  class?: string
}

interface Face {
  icon?: IconName
  image?: string
  label?: string | undefined
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
  const isMaking = () => !!props.id && making(props.id)
  const face = (): Face | undefined => {
    if (props.note) return undefined
    if (props.src) return props.icon ? { image: props.src, label: props.label } : undefined
    if (props.mark) return { icon: props.mark }
    const ext = props.ext
    const label = ext?.toUpperCase() || undefined
    const f = ext === undefined ? undefined : formats().get(ext)
    if (ext !== undefined && !f) return { icon: 'unknownFile', label }
    if (f?.archive && !f.thumbnail) return { icon: 'fileArchive', label }
    if (f?.link && !isMaking()) return { icon: 'globe', label: props.label ?? label }
    return props.failed ? { icon: 'imageOff' } : undefined
  }
  const waiting = () => !props.src && !props.note && !face() && isMaking()
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
        height: props.height ? `${props.height}px` : undefined,
      }}
    >
      {props.src && !props.note && !props.icon && (
        <img class={styles.img} src={props.src} alt="" loading="lazy" decoding="async" draggable={false} />
      )}
      {props.note && (
        <>
          {props.title && <b>{props.title}</b>}
          {props.excerpt}
        </>
      )}
      <Show when={face()}>
        {(f) => (
          <span class={styles.face}>
            {f().image ? (
              <img class={styles.mark} src={f().image} alt="" loading="lazy" decoding="async" draggable={false} />
            ) : (
              <Icon name={f().icon!} size={32} class={styles.mark} />
            )}
            {f().label && <span class={styles.label}>{f().label}</span>}
          </span>
        )}
      </Show>
      {waiting() && <Spinner class={styles.making} />}
      {props.dirty && <span class={styles.dirty} role="img" aria-label="未保存" data-tip="未保存" />}
    </span>
  )
}
