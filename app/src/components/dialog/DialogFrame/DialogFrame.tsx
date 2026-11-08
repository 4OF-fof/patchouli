import { type JSX, onCleanup, onMount } from 'solid-js'
import { coverPage } from '../../media/WebPage/layer'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 開いているダイアログ。キーは、いちばん上のものだけが受ける。 */
const open: HTMLElement[] = []

/** 最近フォーカスのあったもの。メニューから開いたときは、閉じたときにはその項目がもうないので、さかのぼって戻す先を探す */
const focused: HTMLElement[] = []
document.addEventListener(
  'focusin',
  (e) => {
    if (!(e.target instanceof HTMLElement)) return
    focused.push(e.target)
    if (focused.length > 8) focused.shift()
  },
  true,
)

export interface DialogFrameProps {
  label: string
  role?: 'dialog' | 'alertdialog'
  /** 後ろを覆う幕と、枠の見た目 */
  overlayClass?: string
  class?: string
  /** 開いたときにフォーカスを置くもの。省くと枠 */
  focus?: () => HTMLElement | undefined
  onClose?: () => void
  /** 押したキー。Esc で閉じるより前に呼ぶ */
  onKeyDown?: (e: KeyboardEvent) => void
  children: JSX.Element
}

/**
 * ダイアログの外枠。Esc と幕のクリックで閉じ、Tab は枠の中で回し、閉じたら開く前の場所へフォーカスを戻す。
 * キーは中の部品が受けたあと、window のものより先に document で受ける。中で preventDefault したもの（検索欄を空にする Esc など）では閉じず、
 * 閉じた Esc は画面のほかのもの（選択の解除など）へ渡さない。
 */
export function DialogFrame(props: DialogFrameProps) {
  let el!: HTMLDivElement
  let overlay!: HTMLDivElement
  const before = [...focused]
  const trap = (e: KeyboardEvent) => {
    const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.checkVisibility())
    const [first, last] = [all[0], all.at(-1)]
    const at = document.activeElement
    if (!first || !last) {
      e.preventDefault()
      return
    }
    if (!(at instanceof Node && el.contains(at))) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && (at === first || at === el)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && at === last) {
      e.preventDefault()
      first.focus()
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (open.at(-1) !== el) return
    props.onKeyDown?.(e)
    if (e.defaultPrevented || e.isComposing) return
    if (e.key === 'Tab') trap(e)
    else if (e.key === 'Escape' && props.onClose) {
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    }
  }
  onMount(() => {
    open.push(el)
    // 幕はどれも同じ重なりの順なので、あとから開いたものを上に描き、キーを受けるものと見た目をそろえる
    if (open.length > 1) overlay.style.zIndex = `calc(var(--z-dialog) + ${open.length - 1})`
    document.addEventListener('keydown', onKey)
    const first = props.focus?.() ?? el
    first.focus()
  })
  onCleanup(() => {
    open.splice(open.indexOf(el), 1)
    document.removeEventListener('keydown', onKey)
    // 下にまだダイアログがあるときは、その外へは戻さない
    queueMicrotask(() => {
      const under = open.at(-1)
      ;(before.findLast((x) => x.isConnected && (!under || under.contains(x))) ?? under)?.focus()
    })
  })
  return (
    <div
      ref={(e) => {
        overlay = e
        coverPage(e)
      }}
      class={props.overlayClass}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}
    >
      <div
        ref={el}
        class={props.class}
        role={props.role ?? 'dialog'}
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
      >
        {props.children}
      </div>
    </div>
  )
}
