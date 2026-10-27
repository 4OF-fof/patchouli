import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import styles from './NoticesDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export interface NoticeEntry {
  name: string
  version: string
  copyright: string[]
  url?: string
}

export interface NoticeGroup {
  license: string
  entries: NoticeEntry[]
}

export interface Notices {
  self: { name: string; license: string; text: string }
  texts: Record<string, string>
  groups: NoticeGroup[]
}

export interface NoticesDialogProps {
  notices?: Notices
  onClose?: () => void
}

function Group(props: { group: NoticeGroup; texts: Record<string, string> }) {
  const ids = () => props.group.license.split(' AND ').filter((id) => props.texts[id])
  return (
    <>
      <For each={ids()}>
        {(id) => (
          <div class={styles.text}>
            <Show when={ids().length > 1}>
              <h4>{id}</h4>
            </Show>
            <pre>{props.texts[id]}</pre>
          </div>
        )}
      </For>
      <ul>
        <For each={props.group.entries}>
          {(e) => (
            <li>
              <b>{e.name}</b>
              <span>{e.version}</span>
              <div>
                <Show when={e.copyright.length}>
                  <small>{e.copyright.join('\n')}</small>
                </Show>
                <Show when={e.url}>
                  <small class={styles.url}>{e.url}</small>
                </Show>
              </div>
            </li>
          )}
        </For>
      </ul>
    </>
  )
}

export function NoticesDialog(props: NoticesDialogProps) {
  let el!: HTMLDivElement
  // 一覧は長いので、開いたグループだけ描く
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
      <div class={styles.frame} role="dialog" aria-label="権利表示">
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <ScrollArea class={styles.root} viewClass={styles.body} tabIndex={-1} ref={el}>
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
                    3rd Party <small>{n().groups.reduce((c, g) => c + g.entries.length, 0)} 件</small>
                  </h3>
                  <div class={styles.groups}>
                    <For each={n().groups}>
                      {(g) => (
                        <details
                          onToggle={(ev) =>
                            setOpen(
                              ev.currentTarget.open ? [...open(), g.license] : open().filter((k) => k !== g.license),
                            )
                          }
                        >
                          <summary>
                            <b>{g.license}</b>
                            <small>{g.entries.length} 件</small>
                          </summary>
                          <Show when={open().includes(g.license)}>
                            <Group group={g} texts={n().texts} />
                          </Show>
                        </details>
                      )}
                    </For>
                  </div>
                </section>
              </>
            )}
          </Show>
        </ScrollArea>
      </div>
    </div>
  )
}
