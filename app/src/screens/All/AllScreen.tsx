import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { NoneText } from '../../components/base/NoneText/NoneText'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Spinner } from '../../components/base/Spinner/Spinner'
import { useHoverPreview } from '../../components/media/HoverPreview/HoverPreview'
import { ItemCard } from '../../components/media/ItemCard/ItemCard'
import { JustifiedRow } from '../../components/media/JustifiedRow/JustifiedRow'
import { type Library, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './AllScreen.module.css'

const FIRST = 48
const MORE = 40

export interface AllScreenProps {
  lib: Library
  onOpenItem?: (id: string, list: string[]) => void
  onTogglePin?: (id: string) => void
}

/** すべての項目（素材とノート）を、区切らずに並べる。ピン留めしたものが先、ほかは新しい順。 */
export function AllScreen(props: AllScreenProps) {
  let scroll!: HTMLDivElement
  let more: HTMLDivElement | undefined
  const lib = () => props.lib
  const preview = useHoverPreview()
  // ピン留めしたものを留めた順で先に、ほかは新しい順
  const all = createMemo(() => {
    const pins = new Map(lib().pins.map((id, i) => [id, i]))
    const rank = (id: string) => pins.get(id) ?? pins.size
    return lib().items.toSorted((a, b) => rank(a.id) - rank(b.id) || a.moved - b.moved)
  })
  const [shown, setShown] = createSignal(FIRST)
  const visible = () => all().slice(0, shown())

  // 下の端から 1 画面分先までを、待たずに埋める（ホームと同じ）
  const fill = () => {
    const end = more
    if (!end) return
    const limit = scroll.getBoundingClientRect().bottom + scroll.clientHeight
    while (shown() < all().length && end.getBoundingClientRect().top < limit) setShown(shown() + MORE)
  }
  onMount(() => {
    queueMicrotask(fill)
    const ro = new ResizeObserver(fill)
    ro.observe(scroll)
    scroll.addEventListener('scroll', fill, { passive: true })
    onCleanup(() => {
      ro.disconnect()
      scroll.removeEventListener('scroll', fill)
    })
  })

  return (
    <section class={shared.screen} aria-label="すべて">
      <ScrollArea class={shared.scroll} ref={scroll}>
        <div class={shared.page}>
          <header class={shared.mast}>
            <h1>すべて</h1>
            <span class={shared.meta}>{all().length} 件</span>
          </header>
          <Show
            when={all().length}
            fallback={
              <div class={styles.body}>
                <NoneText>まだ項目がありません</NoneText>
              </div>
            }
          >
            <div class={styles.body}>
              <JustifiedRow height={140}>
                <For each={visible()}>
                  {(it) => (
                    <ItemCard
                      {...thumbOf(it, 'M')}
                      name={it.name}
                      ratio={it.ratio}
                      pinned={lib().pins.includes(it.id)}
                      onPin={() => props.onTogglePin?.(it.id)}
                      preview={preview(it, { clock: true })}
                      onClick={() =>
                        props.onOpenItem?.(
                          it.id,
                          all().map((x) => x.id),
                        )
                      }
                    />
                  )}
                </For>
              </JustifiedRow>
            </div>
          </Show>
          <div class={styles.more} ref={more}>
            <Show when={shown() < all().length}>
              <Spinner />
              続きを読み込み中
            </Show>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
