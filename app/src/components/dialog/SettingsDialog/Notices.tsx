import { For, Show, createMemo, createSignal } from 'solid-js'
import { Icon } from '../../base/Icon/Icon'
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

function List(props: { notices: Notices }) {
  const copyright = () => props.notices.self.text.split('\n').find((l) => l.startsWith('Copyright'))
  const entries = createMemo(() =>
    props.notices.groups
      .flatMap((g) => g.entries.map((e) => ({ ...e, license: g.license })))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )
  const [open, setOpen] = createSignal<string[]>([])
  const toggle = (id: string) => setOpen(open().includes(id) ? open().filter((k) => k !== id) : [...open(), id])
  return (
    <>
      <div class={styles.row}>
        <div class={styles.what}>
          <span class={styles.name}>ライセンス</span>
          <Show when={copyright()}>{(c) => <span class={styles.hint}>{c()}</span>}</Show>
        </div>
        <span class={styles.tag}>{props.notices.self.license}</span>
      </div>
      <h4 class={styles.label}>
        使用しているソフトウェア<em>{entries().length}</em>
      </h4>
      <For each={entries()}>
        {(e) => (
          <div class={styles.row}>
            <div class={styles.what}>
              <span class={styles.name}>
                {e.name}
                <small>{e.version}</small>
              </span>
              <Show when={e.copyright.length} fallback={<span class={styles.url}>{e.url}</span>}>
                <span class={styles.hint}>{e.copyright.join('\n')}</span>
              </Show>
            </div>
            <span class={styles.tag}>{e.license}</span>
          </div>
        )}
      </For>
      <h4 class={styles.label}>ライセンスの全文</h4>
      <For each={Object.keys(props.notices.texts)}>
        {(id) => (
          <>
            <button type="button" class={styles.row} aria-expanded={open().includes(id)} onClick={() => toggle(id)}>
              <span class={styles.name}>{id}</span>
              <Icon name="chevronDown" class={styles.chev} />
            </button>
            <Show when={open().includes(id)}>
              <pre class={styles.text}>{props.notices.texts[id]}</pre>
            </Show>
          </>
        )}
      </For>
    </>
  )
}

export function NoticesView(props: { notices?: Notices }) {
  return (
    <Show when={props.notices} fallback={<p class={styles.wait}>読み込み中…</p>}>
      {(n) => <List notices={n()} />}
    </Show>
  )
}
