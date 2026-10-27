import { For, Index, type JSX, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  CommandStatus,
  Deps,
  Part,
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
  /** ないあいだは読み込み中と出す。 */
  report?: PluginReport
  /** 開いたときに選んでおくプラグイン。 */
  pick?: { id: string; dev: boolean }
  actions?: PluginActions
  /** 使うプラグインが変わったとき（入れた・アンインストールしたなど）。ライブラリを開き直す。 */
  onChanged?: () => void | Promise<void>
  /** 設定を変えたとき。一覧を読み直す。 */
  onRefresh?: () => void
  onClose?: () => void
}

const PART: Record<Part, string> = { thumbnail: 'サムネイル', view: '詳細表示', waveform: '波形', hover: 'ホバー表示' }

/** 左の一覧の段。プラグインは、提供するものの種類ごとに分け、開発版はまとめて別の段にする。 */
const GROUPS: { label: string; has: (p: PluginStatus) => boolean }[] = [
  { label: 'ファイル形式', has: (p) => !p.dev && p.formats.length > 0 },
  { label: 'その他', has: (p) => !p.dev && p.formats.length === 0 },
  { label: '開発版', has: (p) => p.dev },
]

const TOOLS = '外部ツール'

/** 左の一覧で外部ツールを選んだときの、選んだものの頭に付ける印。 */
const CMD = ':command:'

/** 左の一覧で開発版を選んだときの、選んだものの頭に付ける印。同じ id の通常のものと見分ける。 */
const DEV = ':dev:'

const keyOf = (p: PluginStatus) => (p.dev ? DEV : '') + p.id

/** 状態の札。使っているものには出さない。 */
const STATE_LABEL: Partial<Record<PluginStatus['state'], string>> = {
  missing: '未導入',
  blocked: '使用不可',
  disabled: '無効',
}

const sourceLabel = (s: PluginSource) => s.local

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const errors = (p: PluginStatus) => p.problems.filter((x) => x.level === 'error').length

/** p が k に書いたもの。必須のものを先に並べる。commands には、依存先を通して動かせるもの（from）も足す。 */
const needs = (p: PluginStatus, k: keyof Deps): { name: string; need: string; min?: string; from?: string }[] => [
  ...Object.entries(p.required[k] ?? {}).map(([name, d]) => ({ name, need: '必須', min: d.min })),
  ...Object.entries(p.optional[k] ?? {}).map(([name, d]) => ({ name, need: '任意', min: d.min })),
  ...(k === 'commands' ? p.via.map((v) => ({ name: v.name, need: v.required ? '必須' : '任意', from: v.plugin })) : []),
]

/** 「必須」「任意」に、版の下限と、どの依存先を通すかを添える。 */
const need = (d: { need: string; min?: string; from?: string }) =>
  [d.need, d.min && `${d.min} 以上`, d.from && `${d.from} から`].filter(Boolean).join('・')

/** p ができること。full は、本体の画面で隔離されずに動くもの。 */
const perms = (p: PluginStatus) => [
  ...(p.formats.length ? [{ label: 'ファイルの読み取り', text: '対応形式のファイルのみ', full: false }] : []),
  ...(needs(p, 'commands').length
    ? [
        {
          label: '外部ツールの実行',
          text: [...new Set(needs(p, 'commands').map((n) => n.name))].join(', '),
          full: false,
        },
      ]
    : []),
  ...(p.caps.some((c) => c.by === 'ui')
    ? [{ label: 'フルアクセス', text: 'アプリの画面上で直接動作し、すべての機能にアクセス可能', full: true }]
    : []),
]

/** f のいまの値。なくなったら、最後にあった値のままにする。 */
const latest = <T,>(f: () => T | undefined) => createMemo<T>((prev) => f() ?? prev, f()!)

/**
 * プラグインの一覧。左でプラグインか外部ツールを選び、右に詳細を出す。
 * プラグインの詳細には、扱うファイルと対象、求めるアプリとプラグイン、権限、エラーと警告、設定を出し、更新する・アンインストールするの操作を受け付ける。
 * 置き場所の要素に position: relative を付けておく。
 */
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

  /** label を出しているあいだに job を動かす（空なら出さない）。changed なら、終わったあとプラグインを読み直す。 */
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
  /** id のプラグイン。開発版と通常のものがあれば、使っているほう。 */
  const byId = (id: string) =>
    plugins().find((p) => p.id === id && p.state === 'active') ?? plugins().find((p) => p.id === id)
  const byName = (name: string) => commands().find((c) => c.name === name)
  /** 選んでいるもの。選んだものがなくなったら、最初のものにする。 */
  const current = createMemo(() => {
    const k = picked()
    if (k?.startsWith(CMD)) return byName(k.slice(CMD.length)) ?? plugins()[0]
    return (k && plugins().find((p) => keyOf(p) === k)) || plugins()[0] || commands()[0]
  })
  /** 検索欄の言葉をどれも含むもの。 */
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
  /** name を求めるプラグイン。 */
  const users = (name: string) =>
    plugins().flatMap((p) => needs(p, 'commands').flatMap((n) => (n.name === name ? [{ p, need: n.need }] : [])))

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

  /** 左の一覧の、開け閉めできる段。 */
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
          <Icon name="chevron" class={styles.chev} />
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
            <Show when={!p().builtin && p().state !== 'missing' && a().setEnabled}>
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
          <Show when={needs(p(), 'plugins').length}>
            <section>
              <h4>依存プラグイン</h4>
              <ul class={styles.deps}>
                <For each={needs(p(), 'plugins')}>
                  {(d) => {
                    const q = () => byId(d.name)
                    const ok = () => q()?.state === 'active'
                    return (
                      <li>
                        <Show when={q()} fallback={<b>{d.name}</b>}>
                          {(dep) => (
                            <button type="button" class={styles.link} onClick={() => setPicked(keyOf(dep()))}>
                              {dep().name}
                            </button>
                          )}
                        </Show>
                        <span class={styles.need}>{need(d)}</span>
                        <span class={styles.state} data-ok={ok()}>
                          {ok() ? '有効' : ((q() && STATE_LABEL[q()!.state]) ?? '未導入')}
                        </span>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </section>
          </Show>
          <Show when={perms(p()).length}>
            <section>
              <h4>権限</h4>
              <ul class={styles.perms}>
                <For each={perms(p())}>
                  {(x) => (
                    <li data-full={x.full}>
                      <b>{x.label}</b>
                      <span>{x.text}</span>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>
          <Show when={needs(p(), 'commands').length}>
            <section>
              <h4>{TOOLS}</h4>
              <ul class={styles.deps}>
                <For each={needs(p(), 'commands')}>
                  {(d) => {
                    const c = () => byName(d.name)
                    return (
                      <li>
                        <Show when={c()} fallback={<b>{d.name}</b>}>
                          <button type="button" class={styles.link} onClick={() => setPicked(CMD + d.name)}>
                            {d.name}
                          </button>
                        </Show>
                        <span class={styles.need}>{need(d)}</span>
                        <Show when={props.report?.commands} fallback={<span class={styles.state}>未確認</span>}>
                          <Show
                            when={c()?.path}
                            fallback={
                              <span class={styles.state} data-ok="false">
                                未検出
                              </span>
                            }
                          >
                            {(path) => (
                              <span class={styles.path} title={path()}>
                                {c()?.version ? `${c()?.version}　${path()}` : path()}
                              </span>
                            )}
                          </Show>
                        </Show>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </section>
          </Show>
        </Show>
        <Show when={p().source}>
          {(s) => (
            <section>
              <h4>取得先</h4>
              <p class={styles.source} title={sourceLabel(s())}>
                {sourceLabel(s())}
              </p>
            </section>
          )}
        </Show>
        <Show when={p().state === 'active' && p().settings.length}>
          <section>
            <h4>設定</h4>
            <div class={styles.settings}>
              <Index each={p().settings}>
                {(s) => (
                  <SettingField
                    setting={s()}
                    disabled={!a().setSetting}
                    onChange={(v) => void save(p().id, s().key, v)}
                  />
                )}
              </Index>
            </div>
          </section>
        </Show>
      </>
    )
  }

  const command = (c: () => CommandStatus) => (
    <>
      <header class={styles.head}>
        <div>
          <h3>{c().name}</h3>
          <span class={styles.badge}>{TOOLS}</span>
        </div>
      </header>
      <p class={styles.where} data-ok={!!c().path} title={c().path}>
        {c().path ?? '未検出'}
      </p>
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
              <Show when={ps().length} fallback={<p class={styles.none}>なし</p>}>
                <span class={styles.chips}>
                  <For each={ps()}>
                    {(u) => (
                      <button type="button" class={styles.user} title={u.p.id} onClick={() => setPicked(u.p.id)}>
                        {u.p.name}
                      </button>
                    )}
                  </For>
                </span>
              </Show>
            </section>
          )
        }}
      </For>
    </>
  )

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
            <Icon name="search" size={14} />
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
                <Icon name="plus" size={14} />
                プラグインを追加
              </Button>
            </div>
          </Show>
        </nav>
        <ScrollArea class={styles.main} viewClass={styles.mainView}>
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
        </ScrollArea>
      </div>
    </div>
  )
}
