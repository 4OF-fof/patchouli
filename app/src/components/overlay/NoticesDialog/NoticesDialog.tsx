import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import styles from './NoticesDialog.module.css'

/** アプリに同梱しているものの 1 つ。 */
export interface NoticeEntry {
  name: string
  version: string
  license: string
  /** 文面が見つからないときに見に行く先。 */
  url?: string
  /** Notices.texts の中の位置。 */
  texts: number[]
}

/** scripts/licenses.ts が作る権利表示。 */
export interface Notices {
  self: { name: string; license: string; text: string }
  /** 名前順。 */
  entries: NoticeEntry[]
  texts: string[]
}

export interface NoticesDialogProps {
  /** ないあいだは読み込み中と出す。 */
  notices?: Notices
  onClose?: () => void
}

/** 権利表示。アプリと、同梱しているもののライセンスを並べる。置き場所の要素に position: relative を付けておく。 */
export function NoticesDialog(props: NoticesDialogProps) {
  let el!: HTMLDivElement
  // 文面は長いので、開いた行だけ描く
  const [open, setOpen] = createSignal<string[]>([])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))
  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <ScrollArea
        class={styles.root}
        viewClass={styles.body}
        role="dialog"
        aria-label="権利表示"
        tabIndex={-1}
        ref={el}
      >
        <h2>権利表示</h2>
        <Show when={props.notices} fallback={<p class={styles.wait}>読み込み中…</p>}>
          {(n) => (
            <>
              <section>
                <h3>
                  {n().self.name} <small>{n().self.license}</small>
                </h3>
                <pre>{n().self.text}</pre>
              </section>
              <section>
                <h3>
                  使っているもの <small>{n().entries.length} 件</small>
                </h3>
                <ul>
                  <For each={n().entries}>
                    {(e) => {
                      const key = `${e.name}@${e.version}`
                      return (
                        <li>
                          <details
                            onToggle={(ev) =>
                              setOpen(ev.currentTarget.open ? [...open(), key] : open().filter((k) => k !== key))
                            }
                          >
                            <summary>
                              <b>{e.name}</b>
                              <span>{e.version}</span>
                              <small>{e.license}</small>
                            </summary>
                            <Show when={open().includes(key)}>
                              <Show
                                when={e.texts.length}
                                fallback={<p class={styles.none}>文面が同梱されていません。{e.url}</p>}
                              >
                                <For each={e.texts}>{(i) => <pre>{n().texts[i]}</pre>}</For>
                              </Show>
                            </Show>
                          </details>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </section>
            </>
          )}
        </Show>
      </ScrollArea>
    </div>
  )
}
