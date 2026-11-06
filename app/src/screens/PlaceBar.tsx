import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { GRACE, OPEN_DELAY, type Point, graceArea, inside } from '../components/nav/CascadeMenu/grace'
import { NavMenu, type NavMenuEntry } from '../components/nav/NavMenu/NavMenu'
import type { Library } from '../model/library'
import { useHost } from '../window/host'
import type { Place, ScreenPlace } from './AppBar'
import styles from './PlaceBar.module.css'

/** いちばん上の段から切り替えられる場所。 */
export const placeEntries = (lib: Library, here: Place | undefined, screens: ScreenPlace[] = []): NavMenuEntry[] => [
  { id: 'home', icon: 'home', label: 'ホーム', current: here === 'home' },
  { id: 'all', icon: 'grid', label: 'すべて', count: lib.items.length, current: here === 'all' },
  { id: 'projects', icon: 'project', label: 'プロジェクト', count: lib.projects.length, current: here === 'projects' },
  { id: 'tags', icon: 'hash', label: 'タグ', count: lib.tagGroups().size, current: here === 'tags' },
  ...(screens.length ? ['separator' as const] : []),
  ...screens.map((s) => ({ id: s.place, icon: s.icon, label: s.label, current: here === s.place })),
]

export interface PlaceBarProps {
  crumbs: string[]
  /** いちばん上の段を押したときに出す場所。 */
  places: () => NavMenuEntry[]
  /** 選んでいる項目の数。0 より大きければ、いまの場所の横に出す。 */
  selected?: number
  onCrumb?: (i: number) => void
  siblingsOf?: (i: number) => NavMenuEntry[] | undefined
  onSibling?: (i: number, id: string) => void
  onPlace?: (id: string) => void
  /** 行の右端に、画面ごとのボタンを置く所。 */
  toolsRef?: (el: HTMLElement) => void
  /** 段の何もないところを押したとき。タブと同じく、つかんで運べるようにする。 */
  onGrab?: (e: PointerEvent) => void
}

const CONTROLS = 'button, a, input, select, textarea, [role="menu"]'

/** タブの画面の上に置く、いまの場所の段。段に乗せると、同じ種類の仲間の一覧を開く。 */
export function PlaceBar(props: PlaceBarProps) {
  const host = useHost()
  const [drop, setDrop] = createSignal<number>()
  const [clicked, setClicked] = createSignal(false)
  const crumbEls: HTMLElement[] = []
  let dropEl: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: number | undefined
  let grace: Point[] | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let pointer: Point | undefined
  let under: Node | undefined
  let onCrumb = false
  let prevAt = -1
  // 入ってきた段。猶予のあいだは待たせ、明けてもまだ上にいれば開く
  let wanted: number | undefined
  const endGrace = () => {
    clearTimeout(graceTimer)
    grace = undefined
  }
  const leave = () => {
    clearTimeout(timer)
    pending = undefined
    endGrace()
    setDrop(undefined)
    setClicked(false)
  }
  const holds = (p: Point) => drop() !== undefined && !!grace && inside(p, grace)
  const enter = (i: number) => {
    if (drop() === i || pending === i) return
    clearTimeout(timer)
    pending = i
    timer = setTimeout(() => {
      pending = undefined
      if (!under || !crumbEls[i]?.contains(under)) return
      endGrace()
      setClicked(false)
      setDrop(i)
    }, OPEN_DELAY)
  }
  // 移動のメニューと同じく、段から出てもメニューへ向かう途中なら閉じず、ほかの段にも反応しない
  const decide = () => {
    const t = under
    const p = pointer
    if (!t || !p) return
    const i = drop()
    if (i !== undefined && !crumbEls[i]?.contains(t) && !dropEl?.contains(t) && !holds(p)) leave()
    if (wanted !== undefined && crumbEls[wanted]?.contains(t) && !holds(p)) {
      enter(wanted)
      wanted = undefined
    }
  }
  const onMove = (e: PointerEvent) => {
    const t = e.target
    if (!(t instanceof Node)) return
    pointer = { x: e.clientX, y: e.clientY }
    under = t
    const at = crumbEls.findIndex((el) => el.contains(t))
    if (at !== prevAt) wanted = at >= 0 ? at : undefined
    prevAt = at
    const i = drop()
    const was = onCrumb
    onCrumb = i !== undefined && crumbEls[i]?.contains(t)
    if (dropEl?.contains(t)) endGrace()
    else if (was && !onCrumb && dropEl) {
      grace = graceArea(pointer, dropEl.getBoundingClientRect(), 'down')
      clearTimeout(graceTimer)
      graceTimer = setTimeout(() => {
        grace = undefined
        decide()
      }, GRACE)
    }
    decide()
  }
  // タブの画面は窓のあいだを動くので、いまの窓で受ける
  createEffect(() => {
    const doc = host().doc
    doc.addEventListener('pointermove', onMove)
    onCleanup(() => doc.removeEventListener('pointermove', onMove))
  })
  onCleanup(() => {
    clearTimeout(timer)
    clearTimeout(graceTimer)
  })
  let tools: HTMLElement | undefined
  const grab = (e: PointerEvent) => {
    const t = e.target
    if (!props.onGrab || !(t instanceof Element) || t.closest(CONTROLS)) return
    if (tools?.contains(t) || dropEl?.contains(t)) return
    props.onGrab(e)
  }
  return (
    <div class={styles.root} onPointerDown={grab}>
      <nav class={styles.crumbs} aria-label="現在の場所">
        <For each={props.crumbs}>
          {(c, i) => {
            const last = () => i() === props.crumbs.length - 1
            const listOf = () => {
              const list = i() === 0 ? props.places() : props.siblingsOf?.(i())
              const entries = list?.filter((e) => e !== 'separator')
              return entries?.length === 1 && entries[0].current ? undefined : list
            }
            const items = () => (drop() === i() ? listOf() : undefined)
            // 最後の段は戻る先がないので、押すと仲間の一覧を開く
            const menu = () => last() && !!listOf()?.length
            return (
              <>
                <Show when={i() > 0}>
                  <span class={styles.sep} aria-hidden="true">
                    /
                  </span>
                </Show>
                <span class={styles.crumbAt}>
                  <button
                    ref={(el) => (crumbEls[i()] = el)}
                    type="button"
                    class={styles.crumb}
                    aria-current={last() ? 'page' : undefined}
                    aria-haspopup={menu() ? 'menu' : undefined}
                    aria-expanded={menu() ? drop() === i() : undefined}
                    data-open={!!items()?.length}
                    onClick={() => {
                      if (menu()) {
                        clearTimeout(timer)
                        pending = undefined
                        endGrace()
                        if (drop() !== i()) {
                          setClicked(true)
                          setDrop(i())
                        }
                        return
                      }
                      if (last()) return
                      leave()
                      props.onCrumb?.(i())
                    }}
                  >
                    {c}
                  </button>
                  <Show when={items()?.length ? items() : undefined}>
                    {(list) => (
                      <div ref={dropEl} class={styles.drop}>
                        <NavMenu
                          focusFirst={clicked()}
                          items={list()}
                          onSelect={(id) => {
                            leave()
                            if (i() === 0) props.onPlace?.(id)
                            else props.onSibling?.(i(), id)
                          }}
                          onClose={leave}
                        />
                      </div>
                    )}
                  </Show>
                </span>
              </>
            )
          }}
        </For>
      </nav>
      <Show when={props.selected}>{(n) => <span class={styles.selected}>{n()} 件を選択中</span>}</Show>
      <span
        class={styles.tools}
        ref={(el) => {
          tools = el
          props.toolsRef?.(el)
        }}
      />
    </div>
  )
}
