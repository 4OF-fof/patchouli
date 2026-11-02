import { For, Show, createSignal } from 'solid-js'
import styles from './Notices.module.css'

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

function Group(props: { group: NoticeGroup; texts: Record<string, string> }) {
  const ids = () => props.group.license.split(' AND ').filter((id) => props.texts[id])
  return (
    <>
      <For each={ids()}>
        {(id) => (
          <div class={styles.text}>
            <Show when={ids().length > 1}>
              <h5>{id}</h5>
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

export function NoticesView(props: { notices?: Notices }) {
  // 一覧は長いので、開いたグループだけ描く
  const [open, setOpen] = createSignal<string[]>([])
  return (
    <Show when={props.notices} fallback={<p class={styles.wait}>読み込み中…</p>}>
      {(n) => (
        <div class={styles.root}>
          <section>
            <h4>
              {n().self.name} <small>{n().self.license}</small>
            </h4>
            <pre>{n().self.text}</pre>
          </section>
          <section>
            <h4>
              3rd Party <small>{n().groups.reduce((c, g) => c + g.entries.length, 0)} 件</small>
            </h4>
            <div class={styles.groups}>
              <For each={n().groups}>
                {(g) => (
                  <details
                    onToggle={(ev) =>
                      setOpen(ev.currentTarget.open ? [...open(), g.license] : open().filter((k) => k !== g.license))
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
        </div>
      )}
    </Show>
  )
}
