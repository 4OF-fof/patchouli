import { For, Index, type JSX, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  CommandStatus,
  Deps,
  CapPart,
  Permission,
  PluginActions,
  PluginReport,
  PluginSource,
  PluginStatus,
  SettingValue,
} from '../../../plugins/types'
import { Icon } from '../../base/Icon/Icon'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import styles from './PluginsDialog.module.css'
import { IconButton } from '../../controls/IconButton/IconButton'

export interface PluginsDialogProps {
  report?: PluginReport
  pick?: { id: string; dev: boolean }
  actions?: PluginActions
  onChanged?: () => void | Promise<void>
  onRefresh?: () => void
  /** 外部ツールの名前 → 自分で指定した場所。 */
  commandPaths?: Record<string, string>
  /** 外部ツールの場所を選ぶ。選ばなかったときは undefined。 */
  onPickCommand?: (name: string) => Promise<string | undefined>
  /** 外部ツールの場所を変える。path がなければ、PATH から探すのに戻す。 */
  onCommandPathChange?: (name: string, path?: string) => Promise<void>
  onClose?: () => void
}

const PART: Record<CapPart, string> = {
  thumbnail: 'サムネイル',
  view: '詳細表示',
  waveform: '波形',
  hover: 'ホバー表示',
  details: 'ファイルの詳細',
  embed: '埋め込み表示',
  menu: '右クリックメニュー',
  content: '内容の読み取り',
  link: 'URL の読み取り',
}

const PERMISSION: Record<Permission, string> = {
  library: 'ライブラリの情報を読む',
  clipboard: 'クリップボードにコピー',
  notes: 'ノートを作成・書き換え',
  edit: '名前とタグを変更',
  assets: '素材を登録・置き換え',
  export: 'ファイルを書き出し',
  embed: '文章を AI で解析',
}

const GROUPS: { label: string; has: (p: PluginStatus) => boolean }[] = [
  { label: 'ファイル形式', has: (p) => !p.dev && p.formats.length > 0 },
  { label: 'URL', has: (p) => !p.dev && p.formats.length === 0 && !!p.links?.length },
  { label: 'その他', has: (p) => !p.dev && p.formats.length === 0 && !p.links?.length },
  { label: '開発版', has: (p) => p.dev },
]

const TOOLS = '外部ツール'

const CMD = ':command:'

const DEV = ':dev:'

const keyOf = (p: PluginStatus) => (p.dev ? DEV : '') + p.id

const STATE_LABEL: Partial<Record<PluginStatus['state'], string>> = {
  missing: '未導入',
  blocked: '使用不可',
  disabled: '無効',
}

const sourceLabel = (s: PluginSource) => s.local

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const errors = (p: PluginStatus) => p.problems.filter((x) => x.level === 'error').length

const describe = (d: object) => ('description' in d && typeof d.description === 'string' ? d.description : undefined)

type Need = { name: string; need: string; min?: string; from?: string; description?: string }

const needs = (p: PluginStatus, k: keyof Deps): Need[] => [
  ...Object.entries(p.required[k] ?? {}).map(([name, d]) => ({
    name,
    need: '必須',
    min: d.min,
    description: describe(d),
  })),
  ...Object.entries(p.optional[k] ?? {}).map(([name, d]) => ({
    name,
    need: '任意',
    min: d.min,
    description: describe(d),
  })),
  ...(k === 'commands' ? p.via.map((v) => ({ name: v.name, need: v.required ? '必須' : '任意', from: v.plugin })) : []),
]

const need = (d: { need: string; min?: string; from?: string }) =>
  [d.need, d.min && `${d.min} 以上`, d.from && `${d.from} から使用`].filter(Boolean).join(' · ')

// フルアクセスはほかの権限を含むので、それと並べるのは外部ツールの実行だけにする
const perms = (p: PluginStatus) => {
  const full = p.caps.some((c) => c.by === 'elevated')
  return [
    ...(full
      ? [{ label: 'フルアクセス', text: 'アプリの画面上で直接動作し、すべての機能にアクセス可能', full: true }]
      : []),
    ...(!full && p.formats.length
      ? [{ label: 'ファイルの読み取り', text: '対応形式のファイルのみ', full: false }]
      : []),
    ...(needs(p, 'commands').length
      ? [
          {
            label: '外部ツールの実行',
            text: [...new Set(needs(p, 'commands').map((n) => n.name))].join(', '),
            full: false,
          },
        ]
      : []),
  ]
}

const latest = <T,>(f: () => T | undefined) => createMemo<T>((prev) => f() ?? prev, f()!)

export function PluginsDialog(props: PluginsDialogProps) {
  let el!: HTMLDivElement
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [picked, setPicked] = createSignal(props.pick && (props.pick.dev ? DEV : '') + props.pick.id)
  const [closed, setClosed] = createSignal<string[]>([])
  const [query, setQuery] = createSignal('')
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const run = async (label: string, job: () => Promise<boolean | void>, changed = true) => {
    setBusy(label)
    setError(undefined)
    try {
      if ((await job()) === false) return
      if (changed) await props.onChanged?.()
      else props.onRefresh?.()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(undefined)
    }
  }
  const a = () => props.actions ?? {}
  const plugins = () => props.report?.plugins ?? []
  const commands = () => props.report?.commands ?? []
  const byId = (id: string) =>
    plugins().find((p) => p.id === id && p.state === 'active') ?? plugins().find((p) => p.id === id)
  const byName = (name: string) => commands().find((c) => c.name === name)
  const current = createMemo(() => {
    const k = picked()
    if (k?.startsWith(CMD)) return byName(k.slice(CMD.length)) ?? plugins()[0]
    return (k && plugins().find((p) => keyOf(p) === k)) || plugins()[0] || commands()[0]
  })
  const hit = (...texts: string[]) => {
    const t = texts.join(' ').toLowerCase()
    return query()
      .toLowerCase()
      .split(/\s+/)
      .every((w) => t.includes(w))
  }
  const shown = (g: (typeof GROUPS)[number]) =>
    plugins().filter((p) => g.has(p) && hit(p.name, p.id, ...p.formats.map((f) => `.${f}`)))
  const shownCommands = () => commands().filter((c) => hit(c.name))
  const pickedPlugin = () => {
    const v = current()
    return v && 'formats' in v ? v : undefined
  }
  const pickedCommand = () => {
    const v = current()
    return v && !('formats' in v) ? v : undefined
  }
  /** 選んでいるものの印。一覧を読み直しても、これが変わらないあいだは詳細を描き直さない。 */
  const key = createMemo(() => {
    const p = pickedPlugin()
    return p ? keyOf(p) : pickedCommand() && CMD + pickedCommand()!.name
  })
  const users = (name: string) =>
    plugins().flatMap((p) =>
      needs(p, 'commands').flatMap((n) => (n.name === name ? [{ p, need: n.need, description: n.description }] : [])),
    )

  /** 設定を保存する。入力中の欄を止めないよう、ほかの操作は止めない。 */
  const save = async (id: string, name: string, v: SettingValue) => {
    setError(undefined)
    try {
      await a().setSetting!(id, name, v)
      props.onRefresh?.()
    } catch (e) {
      setError(message(e))
    }
  }

  const install = () => void run('', () => a().install!())

  const group = (label: string, count: number, body: () => JSX.Element) => {
    const open = () => !closed().includes(label)
    return (
      <section class={styles.group}>
        <button
          type="button"
          class={styles.groupHead}
          aria-expanded={open()}
          onClick={() => setClosed(open() ? [...closed(), label] : closed().filter((k) => k !== label))}
        >
          <Icon name="chevron" class={styles.chev} withText />
          <span>{label}</span>
          <em>{count}</em>
        </button>
        <Show when={open()}>{body()}</Show>
      </section>
    )
  }

  const detail = (p: () => PluginStatus) => {
    const outdated = () => p().state === 'active' && !!p().recorded && p().recorded !== p().version
    return (
      <>
        <header class={styles.head}>
          <div>
            <h3>{p().name}</h3>
            <Show when={p().version}>
              <span class={styles.mono}>{p().version}</span>
            </Show>
            <Show when={p().builtin}>
              <span class={styles.badge}>組み込み</span>
            </Show>
            <Show when={p().dev}>
              <span class={styles.badge}>開発版</span>
            </Show>
            <Show when={STATE_LABEL[p().state]}>
              {(label) => (
                <span class={styles.badge} data-tone={p().state === 'disabled' ? undefined : 'danger'}>
                  {label()}
                </span>
              )}
            </Show>
          </div>
          <div class={styles.actions}>
            <Show when={p().state !== 'missing' && a().setEnabled}>
              <Button
                size="sm"
                variant={p().enabled ? undefined : 'primary'}
                disabled={busy() !== undefined}
                onClick={() => void run('', () => a().setEnabled!(p().id, p().dev, !p().enabled))}
              >
                {p().enabled ? '無効化' : '有効化'}
              </Button>
            </Show>
            <Show when={outdated() && a().update && p().source}>
              <Button
                size="sm"
                variant="primary"
                disabled={busy() !== undefined}
                onClick={() => void run(`${p().name} を更新しています`, () => a().update!(p().id))}
              >
                {p().recorded} に更新
              </Button>
            </Show>
            <Show when={p().state === 'missing' && a().update && p().source}>
              <Button
                size="sm"
                variant="primary"
                disabled={busy() !== undefined}
                onClick={() => void run(`${p().name} をインストールしています`, () => a().update!(p().id))}
              >
                インストール
              </Button>
            </Show>
            <Show when={!p().builtin && !p().dev && a().remove}>
              <Button
                size="sm"
                variant="danger"
                disabled={busy() !== undefined}
                onClick={() => void run(`${p().name} をアンインストールしています`, () => a().remove!(p().id))}
              >
                アンインストール
              </Button>
            </Show>
          </div>
        </header>
        <p class={styles.id}>{p().id}</p>
        <Show when={p().description}>
          <p class={styles.desc}>{p().description}</p>
        </Show>
        <Show when={p().problems.length}>
          <ul class={styles.problems}>
            <For each={p().problems}>{(x) => <li data-level={x.level}>{x.text}</li>}</For>
          </ul>
        </Show>
        <Show when={p().state !== 'missing'}>
          <Show when={p().formats.length}>
            <section>
              <h4>対応形式</h4>
              <span class={styles.chips}>
                <For each={p().formats}>{(f) => <span class={styles.ext}>.{f}</span>}</For>
              </span>
            </section>
          </Show>
          <Show when={p().caps.length}>
            <section>
              <h4>対応機能</h4>
              <span class={styles.chips}>
                <For each={p().caps}>{(c) => <span class={styles.cap}>{PART[c.part]}</span>}</For>
              </span>
            </section>
          </Show>
          <Show when={p().screens?.length}>
            <section>
              <h4>画面</h4>
              <span class={styles.chips}>
                <For each={p().screens}>{(s) => <span class={styles.cap}>{s}</span>}</For>
              </span>
            </section>
          </Show>
          <Show when={p().permissions?.length}>
            <section>
              <h4>権限</h4>
              <span class={styles.chips}>
                <For each={p().permissions}>{(x) => <span class={styles.cap}>{PERMISSION[x]}</span>}</For>
              </span>
            </section>
          </Show>
          <Show when={needs(p(), 'plugins').length}>
            <section>
              <h4>依存プラグイン</h4>
              <For each={needs(p(), 'plugins')}>
                {(d) => {
                  const q = () => byId(d.name)
                  const ok = () => q()?.state === 'active'
                  return (
                    <div class={styles.row}>
                      <div class={styles.what}>
                        <Show when={q()} fallback={<span class={styles.name}>{d.name}</span>}>
                          {(dep) => (
                            <button type="button" class={styles.link} onClick={() => setPicked(keyOf(dep()))}>
                              {dep().name}
                            </button>
                          )}
                        </Show>
                        <span class={styles.hint}>{need(d)}</span>
                      </div>
                      <span class={styles.state} data-ok={ok()}>
                        {ok() ? '有効' : ((q() && STATE_LABEL[q()!.state]) ?? '未導入')}
                      </span>
                    </div>
                  )
                }}
              </For>
            </section>
          </Show>
          <Show when={needs(p(), 'commands').length}>
            <section>
              <h4>{TOOLS}</h4>
              <For each={needs(p(), 'commands')}>
                {(d) => {
                  const c = () => byName(d.name)
                  return (
                    <div class={styles.row}>
                      <div class={styles.what}>
                        <Show when={c()} fallback={<span class={styles.name}>{d.name}</span>}>
                          <button type="button" class={styles.link} onClick={() => setPicked(CMD + d.name)}>
                            {d.name}
                          </button>
                        </Show>
                        <Show when={d.description}>
                          <span class={styles.use}>{d.description}</span>
                        </Show>
                        <span class={styles.hint}>{need(d)}</span>
                        <Show when={c()?.path}>
                          {(path) => (
                            <span class={styles.path} data-tip={path()}>
                              {path()}
                            </span>
                          )}
                        </Show>
                      </div>
                      <Show when={props.report?.commands} fallback={<span class={styles.state}>未確認</span>}>
                        <span class={styles.state} data-ok={!!c()?.path}>
                          {c()?.path ? (c()?.version ?? '検出') : '未検出'}
                        </span>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </section>
          </Show>
          <Show when={perms(p()).length}>
            <section>
              <h4>権限</h4>
              <For each={perms(p())}>
                {(x) => (
                  <div class={styles.row} data-full={x.full}>
                    <div class={styles.what}>
                      <span class={styles.name}>{x.label}</span>
                      <span class={styles.hint}>{x.text}</span>
                    </div>
                  </div>
                )}
              </For>
            </section>
          </Show>
        </Show>
        <Show when={p().source}>
          {(s) => (
            <section>
              <h4>取得先</h4>
              <div class={styles.row}>
                <span class={styles.path} data-tip={sourceLabel(s())}>
                  {sourceLabel(s())}
                </span>
              </div>
            </section>
          )}
        </Show>
        <Show when={p().state === 'active' && p().settings.length}>
          <section>
            <h4>設定</h4>
            <Index each={p().settings}>
              {(s) => (
                <div class={styles.field}>
                  <SettingField
                    setting={s()}
                    disabled={!a().setSetting}
                    onChange={(v) => void save(p().id, s().key, v)}
                  />
                </div>
              )}
            </Index>
          </section>
        </Show>
      </>
    )
  }

  const pickCommand = async (name: string) => {
    setError(undefined)
    try {
      const path = await props.onPickCommand!(name)
      if (path) await run(`${name} の場所を変えています`, () => props.onCommandPathChange!(name, path))
    } catch (e) {
      setError(message(e))
    }
  }

  const command = (c: () => CommandStatus) => {
    const fixed = () => props.commandPaths?.[c().name]
    return (
      <>
        <header class={styles.head}>
          <div>
            <h3>{c().name}</h3>
            <Show when={c().version}>
              <span class={styles.mono}>{c().version}</span>
            </Show>
            <span class={styles.badge}>{TOOLS}</span>
          </div>
        </header>
        <div class={`${styles.row} ${styles.where}`}>
          <div class={styles.what}>
            <span class={styles.name}>場所</span>
            <span class={styles.path} data-ok={!!c().path} data-tip={c().path ?? fixed()}>
              {c().path
                ? `${fixed() ? '指定' : '自動'}：${c().path}`
                : fixed()
                  ? `見つかりません：${fixed()}`
                  : '未検出。PATH から探しています'}
            </span>
          </div>
          <Show when={props.onPickCommand && props.onCommandPathChange}>
            <Show when={fixed()}>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy() !== undefined}
                onClick={() => void run(`${c().name} の場所を戻しています`, () => props.onCommandPathChange!(c().name))}
              >
                自動に戻す
              </Button>
            </Show>
            <Button size="sm" disabled={busy() !== undefined} onClick={() => void pickCommand(c().name)}>
              場所を指定
            </Button>
          </Show>
        </div>
        <For
          each={[
            { label: '必須としているプラグイン', need: '必須' },
            { label: '任意で使用するプラグイン', need: '任意' },
          ]}
        >
          {(g) => {
            const ps = () => users(c().name).filter((u) => u.need === g.need)
            return (
              <section>
                <h4>{g.label}</h4>
                <For each={ps()} fallback={<p class={styles.none}>なし</p>}>
                  {(u) => (
                    <div class={styles.row}>
                      <div class={styles.what}>
                        <button type="button" class={styles.link} data-tip={u.p.id} onClick={() => setPicked(u.p.id)}>
                          {u.p.name}
                        </button>
                        <Show when={u.description}>
                          <span class={styles.use}>{u.description}</span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </section>
            )
          }}
        </For>
      </>
    )
  }

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="プラグイン" tabIndex={-1} ref={el}>
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <nav class={styles.side}>
          <h2>プラグイン</h2>
          <label class={styles.search}>
            <Icon name="search" size={14} withText />
            <input
              type="search"
              placeholder="検索"
              aria-label="プラグインと外部ツールを検索"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <ScrollArea class={styles.list} viewClass={styles.listView}>
            <Show when={props.report} fallback={<p class={styles.none}>読み込み中…</p>}>
              <For each={GROUPS}>
                {(g) => (
                  <Show when={shown(g).length}>
                    {(n) =>
                      group(g.label, n(), () => (
                        <For each={shown(g)}>
                          {(p) => (
                            <button
                              type="button"
                              class={styles.item}
                              aria-current={current() === p}
                              data-missing={p.state !== 'active'}
                              onClick={() => setPicked(keyOf(p))}
                            >
                              <span>{p.name}</span>
                              <Show when={p.problems.length}>
                                <i data-level={errors(p) ? 'error' : 'warning'}>{p.problems.length}</i>
                              </Show>
                            </button>
                          )}
                        </For>
                      ))
                    }
                  </Show>
                )}
              </For>
              <Show when={shownCommands().length}>
                {group(TOOLS, shownCommands().length, () => (
                  <For each={shownCommands()}>
                    {(c) => (
                      <button
                        type="button"
                        class={styles.item}
                        aria-current={current() === c}
                        data-missing={!c.path}
                        onClick={() => setPicked(CMD + c.name)}
                      >
                        <span>{c.name}</span>
                        <Show when={!c.path}>
                          <i data-level={users(c.name).some((u) => u.need === '必須') ? 'error' : 'warning'}>未検出</i>
                        </Show>
                      </button>
                    )}
                  </For>
                ))}
              </Show>
              <Show when={!GROUPS.some((g) => shown(g).length) && !shownCommands().length}>
                <p class={styles.none}>見つかりません</p>
              </Show>
            </Show>
          </ScrollArea>
          <Show when={a().install}>
            <div class={styles.foot}>
              <Button class={styles.addButton} variant="primary" disabled={busy() !== undefined} onClick={install}>
                <Icon name="plus" size={14} withText />
                プラグインを追加
              </Button>
            </div>
          </Show>
        </nav>
        <ScrollArea class={styles.main} viewClass={styles.mainView}>
          <div class={styles.page}>
            <Show when={busy() || error()}>
              <p class={styles.status} data-error={!!error()} role="status">
                {error() ?? `${busy()}…`}
              </p>
            </Show>
            <Show when={props.report}>
              <Show when={key()} keyed>
                {(k) => (k.startsWith(CMD) ? command(latest(pickedCommand)) : detail(latest(pickedPlugin)))}
              </Show>
            </Show>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
