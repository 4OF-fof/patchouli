import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { Need, Part, PluginActions, PluginReport, PluginSource, PluginStatus } from '../../../plugins/types'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import styles from './PluginsDialog.module.css'

export interface PluginsDialogProps {
  /** ないあいだは読み込み中と出す。 */
  report?: PluginReport
  actions?: PluginActions
  /** 使うプラグインが変わったとき（入れた・外したなど）。ライブラリを開き直す。 */
  onChanged?: () => void
  /** 設定を変えたとき。一覧を読み直す。 */
  onRefresh?: () => void
  onClose?: () => void
}

const NEED: Record<Need, string> = { none: '使わない', optional: 'あれば使う', required: '必須' }

const PART: Record<Part, string> = { thumbnail: 'サムネイル', view: '詳細の表示' }

const sourceLabel = (s: PluginSource) => s.local

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * プラグインの一覧。受け持つ形式、エラーと警告、設定を出し、入れる・更新する・外すの操作を受け付ける。
 * 置き場所の要素に position: relative を付けておく。
 */
export function PluginsDialog(props: PluginsDialogProps) {
  let el!: HTMLDivElement
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))

  /** label を出しているあいだに job を動かす。changed なら、終わったあとライブラリを開き直す。 */
  const run = async (label: string, job: () => Promise<boolean | void>, changed = true) => {
    setBusy(label)
    setError(undefined)
    try {
      if ((await job()) === false) return
      if (changed) props.onChanged?.()
      else props.onRefresh?.()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(undefined)
    }
  }
  const a = () => props.actions ?? {}
  const inLibrary = () => props.report?.plugins.filter((p) => p.state !== 'unused') ?? []
  const unused = () => props.report?.plugins.filter((p) => p.state === 'unused') ?? []

  const row = (p: PluginStatus) => {
    const outdated = () => p.state === 'active' && !!p.recorded && p.recorded !== p.version
    return (
      <li data-state={p.state}>
        <div class={styles.head}>
          <b>{p.name}</b>
          <Show when={p.version}>
            <span class={styles.mono}>{p.version}</span>
          </Show>
          <Show when={p.builtin}>
            <span class={styles.badge}>組み込み</span>
          </Show>
          <Show when={p.state === 'missing'}>
            <span class={styles.badge} data-tone="danger">
              入っていない
            </span>
          </Show>
          <span class={styles.id}>{p.id}</span>
        </div>
        <Show when={p.description}>
          <p class={styles.desc}>{p.description}</p>
        </Show>
        <Show when={p.caps.length}>
          <div class={styles.caps}>
            <For each={p.caps}>
              {(c) => (
                <span
                  class={styles.cap}
                  data-by={c.by}
                  title={c.by === 'ui' ? '隔離されずに、本体の画面で動く' : 'WASM が受け持ち、本体が描く'}
                >
                  {PART[c.part]}
                  {c.by === 'ui' && '（隔離しない UI）'}
                </span>
              )}
            </For>
          </div>
        </Show>
        <div class={styles.meta}>
          <span class={styles.formats}>
            <For each={p.formats} fallback={<span>受け持つ形式なし</span>}>
              {(f) => <span class={styles.ext}>.{f}</span>}
            </For>
          </span>
          <span>FFmpeg: {NEED[p.ffmpeg]}</span>
        </div>
        <Show when={p.source}>
          {(s) => (
            <p class={styles.source} title={sourceLabel(s())}>
              取得先: {sourceLabel(s())}
            </p>
          )}
        </Show>
        <Show when={p.problems.length}>
          <ul class={styles.problems}>
            <For each={p.problems}>
              {(x) => (
                <li data-level={x.level}>
                  <b>{x.level === 'error' ? 'エラー' : '警告'}</b>
                  {x.text}
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={p.state === 'active' && p.settings.length}>
          <div class={styles.settings}>
            <For each={p.settings}>
              {(s) => (
                <SettingField
                  setting={s}
                  disabled={!a().setSetting || !!busy()}
                  onChange={(v) => void run('設定を保存しています', () => a().setSetting!(p.id, s.key, v), false)}
                />
              )}
            </For>
          </div>
        </Show>
        <div class={styles.actions}>
          <Show when={outdated() && a().update && p.source}>
            <Button
              size="sm"
              variant="primary"
              disabled={!!busy()}
              onClick={() => void run(`${p.name} を更新しています`, () => a().update!(p.id))}
            >
              {p.recorded} に更新
            </Button>
          </Show>
          <Show when={p.state === 'missing' && a().update && p.source}>
            <Button
              size="sm"
              variant="primary"
              disabled={!!busy()}
              onClick={() => void run(`${p.name} を入れています`, () => a().update!(p.id))}
            >
              取得先から入れる
            </Button>
          </Show>
          <Show when={p.state === 'unused' && a().use}>
            <Button
              size="sm"
              disabled={!!busy()}
              onClick={() => void run(`${p.name} を使えるようにしています`, () => a().use!(p.id))}
            >
              このライブラリで使う
            </Button>
          </Show>
          <Show when={p.state !== 'unused' && !p.builtin && a().remove}>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!busy()}
              onClick={() => void run(`${p.name} を外しています`, () => a().remove!(p.id))}
            >
              このライブラリから外す
            </Button>
          </Show>
        </div>
      </li>
    )
  }

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <ScrollArea
        class={styles.root}
        viewClass={styles.body}
        role="dialog"
        aria-label="プラグイン"
        tabIndex={-1}
        ref={el}
      >
        <h2>プラグイン</h2>
        <Show when={props.report} fallback={<p class={styles.note}>読み込み中…</p>}>
          {(r) => (
            <>
              <div class={styles.ffmpeg}>
                <b>FFmpeg</b>
                <Show
                  when={r().ffmpeg}
                  fallback={
                    <span>
                      {r().ffmpeg === null
                        ? '見つかりません。FFmpeg を使う処理は、OS の機能で代わりにします'
                        : 'この環境では使いません'}
                    </span>
                  }
                >
                  {(f) => (
                    <span>
                      {f().version} <small title={f().path}>{f().path}</small>
                    </span>
                  )}
                </Show>
              </div>
              <Show when={busy() || error()}>
                <p class={styles.status} data-error={!!error()} role="status">
                  {error() ?? `${busy()}…`}
                </p>
              </Show>
              <ul class={styles.list}>
                <For each={inLibrary()}>{row}</For>
              </ul>
              <Show when={unused().length}>
                <h3>アプリに入っているが、このライブラリでは使っていないもの</h3>
                <ul class={styles.list}>
                  <For each={unused()}>{row}</For>
                </ul>
              </Show>
              <Show when={a().install}>
                {(install) => (
                  <section class={styles.add}>
                    <h3>プラグインを入れる</h3>
                    <div class={styles.actions}>
                      <Button
                        size="sm"
                        disabled={!!busy()}
                        onClick={() => void run('フォルダから入れています', () => install()('folder'))}
                      >
                        フォルダから入れる
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!busy()}
                        onClick={() => void run('zip から入れています', () => install()('zip'))}
                      >
                        zip から入れる
                      </Button>
                    </div>
                    <p class={styles.note}>
                      入れたプラグインは、このライブラリに記録します。記録のないライブラリでは使いません。
                    </p>
                  </section>
                )}
              </Show>
            </>
          )}
        </Show>
      </ScrollArea>
    </div>
  )
}
