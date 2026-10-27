import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { Developer } from '../../../backend/types'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import styles from './DeveloperDialog.module.css'

export interface DeveloperDialogProps {
  /** ないあいだは読み込み中と出す。 */
  developer?: Developer
  /** 設定を変える。変えたあとは、呼んだ側がライブラリを開き直す。 */
  onChange?: (d: Developer) => Promise<void>
  /** 開発版を置くフォルダを選ぶ窓を出す。選ばなかったときは undefined。 */
  onPickDir?: () => Promise<string | undefined>
  /** プラグインを読み直す（ライブラリを開き直す）。 */
  onReload?: () => void
  onClose?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 設定の「開発者モード」。オンのあいだは、選んだフォルダの中の `<名前>/plugin.json` を開発版のプラグインとして読む。
 * 置き場所の要素に position: relative を付けておく。
 */
export function DeveloperDialog(props: DeveloperDialogProps) {
  let el!: HTMLDivElement
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  /** 変えられなかったときに増やし、スイッチを渡された値に描き直す。 */
  const [failed, setFailed] = createSignal(0)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const save = async (label: string, d: Developer) => {
    setBusy(label)
    setError(undefined)
    try {
      await props.onChange!(d)
    } catch (e) {
      setError(message(e))
      setFailed(failed() + 1)
    } finally {
      setBusy(undefined)
    }
  }
  const pick = async (d: Developer) => {
    setError(undefined)
    try {
      const dir = await props.onPickDir!()
      if (dir) await save('フォルダを変更しています', { ...d, pluginDir: dir })
    } catch (e) {
      setError(message(e))
    }
  }

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="開発者モード" tabIndex={-1} ref={el}>
        <h2>開発者モード</h2>
        <ScrollArea class={styles.main} viewClass={styles.mainView}>
          <Show when={busy() || error()}>
            <p class={styles.status} data-error={!!error()} role="status">
              {error() ?? `${busy()}…`}
            </p>
          </Show>
          <Show when={props.developer} fallback={<p class={styles.note}>読み込み中…</p>}>
            {(d) => (
              <>
                <section>
                  <For each={[failed()]}>
                    {() => (
                      <SettingField
                        setting={{
                          key: 'enabled',
                          label: '開発者モードを有効化',
                          kind: 'toggle',
                          default: false,
                          value: d().enabled,
                        }}
                        disabled={!props.onChange || busy() !== undefined}
                        onChange={(v) =>
                          void save(v ? '開発者モードを有効にしています' : '開発者モードを無効にしています', {
                            ...d(),
                            enabled: v === true,
                          })
                        }
                      />
                    )}
                  </For>
                </section>
                <section>
                  <h4>開発版のプラグイン</h4>
                  <p class={styles.note}>
                    フォルダの中の「&lt;名前&gt;/plugin.json」を、開発版としてプラグインの一覧に表示します。
                    検出した直後は無効です。
                  </p>
                  <div class={styles.row}>
                    <span class={styles.path} data-empty={!d().pluginDir} title={d().pluginDir}>
                      {d().pluginDir ?? 'フォルダが選択されていません'}
                    </span>
                    <Show when={props.onPickDir}>
                      <Button size="sm" disabled={busy() !== undefined} onClick={() => void pick(d())}>
                        選択
                      </Button>
                    </Show>
                  </div>
                  <Show when={props.onReload}>
                    {(reload) => (
                      <div class={styles.row}>
                        <span class={styles.grow} />
                        <Button
                          size="sm"
                          disabled={busy() !== undefined || !d().enabled || !d().pluginDir}
                          onClick={() => reload()()}
                        >
                          プラグインを再読み込み
                        </Button>
                      </div>
                    )}
                  </Show>
                </section>
              </>
            )}
          </Show>
        </ScrollArea>
      </div>
    </div>
  )
}
