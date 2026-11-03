import { For, type JSX, Show, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  AppSettings,
  AutoTag,
  AutoTagProgress,
  CacheKind,
  CacheUsage,
  Developer,
  TagSuggest,
  UnusedPlugin,
} from '../../../backend/types'
import { DEFAULT_PREFS, type Prefs } from '../../../model/prefs'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import { type Notices, NoticesView } from './Notices'
import styles from './SettingsDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

export type SettingsPage = 'general' | 'view' | 'note' | 'developer' | 'about'

export interface SettingsDialogProps {
  version: string
  /** 開いたときに出すページ。 */
  page?: SettingsPage
  prefs?: Prefs
  onPrefsChange?: (patch: Partial<Prefs>) => void
  /** いま開いているライブラリの場所。 */
  library?: string
  onOpenLibraries?: () => void
  app?: AppSettings
  onAppChange?: (s: AppSettings) => Promise<void>
  autoTag?: AutoTag
  autoTagProgress?: AutoTagProgress
  /** 有効にするときは、ダウンロードし終えるまで待つ。 */
  onAutoTagChange?: (on: boolean) => Promise<void>
  onCancelDownload?: () => Promise<void>
  onSuggestChange?: (mode: TagSuggest) => Promise<void>
  onSearchChange?: (on: boolean) => Promise<void>
  usage?: CacheUsage
  unused?: UnusedPlugin[]
  onClear?: (kind: CacheKind) => Promise<void>
  onRemoveUnused?: () => Promise<void>
  developer?: Developer
  onDeveloperChange?: (d: Developer) => Promise<void>
  onPickDevPath?: (kind: 'dir' | 'repo') => Promise<string | undefined>
  onReload?: () => void
  /** 権利表示を読む。一覧が大きいので、開いたときに読む。 */
  loadNotices?: () => Promise<Notices>
  onClose?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const bytesLabel = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`
}

const CACHES: { kind: CacheKind; label: string }[] = [
  { kind: 'library', label: 'インデックス' },
  { kind: 'thumbs', label: 'サムネイル' },
  { kind: 'all', label: 'すべて' },
]

const SUGGEST: { value: TagSuggest; label: string; help: string }[] = [
  {
    value: 'auto',
    label: '自動で適用',
    help: '選択済みの候補をそのまま付けます。候補を選択できなかった項目は、分類の確認に表示します',
  },
  { value: 'confirm', label: '確認してから適用', help: '候補を分類の確認に表示し、承認したタグを付けます' },
  { value: 'off', label: '無効', help: 'タグの候補を作成しません' },
]

const progressLabel = (p: AutoTagProgress) => `${p.file}: ${Math.floor((p.done / p.total) * 100)}%`

const PLACES = {
  dir: { key: 'pluginDirs', label: '開発用プラグインのフォルダ', noun: 'フォルダ' },
  repo: { key: 'repos', label: 'プラグインのリポジトリ', noun: 'リポジトリ' },
} as const

const SIZES = [
  { value: 'S', label: '小' },
  { value: 'M', label: '中' },
  { value: 'L', label: '大' },
] as const

interface Entry {
  page: SettingsPage
  /** ページの中の小見出し。続く項目が同じ小見出しなら、まとめて 1 つの下に並べる。 */
  group?: string
  /** 検索で当てる言葉。項目の名前と説明を並べる。 */
  words: string
  body: () => JSX.Element
}

const grouped = (group: string, list: Entry[]) => list.map((e) => ({ ...e, group }))

export function SettingsDialog(props: SettingsDialogProps) {
  let el!: HTMLDivElement
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  /** 変えられなかったときに増やし、スイッチを渡された値に描き直す。 */
  const [failed, setFailed] = createSignal(0)
  const [query, setQuery] = createSignal('')
  const [noticesOpen, setNoticesOpen] = createSignal(false)
  const [notices] = createResource(
    () => (noticesOpen() && props.loadNotices) || undefined,
    (load) => load(),
  )
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) props.onClose?.()
  }
  onMount(() => {
    el.focus()
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label)
    setError(undefined)
    try {
      await job()
    } catch (e) {
      setError(message(e))
      setFailed(failed() + 1)
    } finally {
      setBusy(undefined)
    }
  }
  const [switching, setSwitching] = createSignal(false)
  const changeAutoTag = async (change: (on: boolean) => Promise<void>, on: boolean) => {
    setSwitching(true)
    setError(undefined)
    try {
      await change(on)
    } catch (e) {
      setError(message(e))
      setFailed(failed() + 1)
    } finally {
      setSwitching(false)
    }
  }
  const downloading = () => switching() || !!props.autoTag?.downloading

  const unusedBytes = () => (props.unused ?? []).reduce((n, p) => n + p.bytes, 0)
  const sizeOf = (u: CacheUsage, kind: CacheKind) =>
    kind === 'library' ? u.library : kind === 'thumbs' ? u.thumbs : u.library + u.thumbs + unusedBytes()

  const addPath = async (d: Developer, kind: 'dir' | 'repo') => {
    const { key, noun } = PLACES[kind]
    setError(undefined)
    try {
      const p = await props.onPickDevPath!(kind)
      if (p && !d[key].includes(p))
        await run(`${noun}を追加しています`, () => props.onDeveloperChange!({ ...d, [key]: [...d[key], p] }))
    } catch (e) {
      setError(message(e))
    }
  }
  const removePath = (d: Developer, kind: 'dir' | 'repo', p: string) => {
    const { key, noun } = PLACES[kind]
    void run(`${noun}を削除しています`, () => props.onDeveloperChange!({ ...d, [key]: d[key].filter((x) => x !== p) }))
  }

  const prefs = () => props.prefs ?? DEFAULT_PREFS
  /** 画面まわりの設定 1 つ。選んだ値は、choices にあるものだけを渡す。 */
  const pref = <K extends keyof Prefs>(
    page: SettingsPage,
    key: K,
    label: string,
    choices: readonly { value: Prefs[K] & string; label: string }[] | 'toggle',
    help?: string,
  ): Entry => ({
    page,
    words: `${label} ${help ?? ''} ${choices === 'toggle' ? '' : choices.map((c) => c.label).join(' ')}`,
    body: () => (
      <div class={styles.field}>
        <SettingField
          setting={
            choices === 'toggle'
              ? { key, label, kind: 'toggle', default: DEFAULT_PREFS[key], value: prefs()[key], help }
              : {
                  key,
                  label,
                  kind: 'choice',
                  choices: [...choices],
                  default: DEFAULT_PREFS[key],
                  value: prefs()[key],
                  help,
                }
          }
          onChange={(v) => {
            const next = choices === 'toggle' ? v === true : choices.find((c) => c.value === v)?.value
            if (next !== undefined) props.onPrefsChange?.({ [key]: next })
          }}
        />
      </div>
    ),
  })

  const setApp = (patch: Partial<AppSettings>, label: string) => {
    const a = props.app
    const change = props.onAppChange
    if (a && change) void run(label, () => change({ ...a, ...patch }))
  }

  const entries = (): Entry[] => [
    ...grouped('起動', [
      pref('general', 'start', '起動時に開く画面', [
        { value: 'last', label: '前回のタブ' },
        { value: 'home', label: 'ホーム' },
      ]),
      pref(
        'general',
        'openLink',
        'リンクを押したときの開き方',
        [
          { value: 'peek', label: '重ねて表示' },
          { value: 'here', label: 'いまのタブ' },
          { value: 'tab', label: '新しいタブ' },
        ],
        'ノートのリンクを押したとき。中クリックでは、いつも新しいタブで開きます',
      ),
    ]),
    pref('view', 'theme', 'テーマ', [
      { value: 'system', label: 'システムに合わせる' },
      { value: 'light', label: 'ライト' },
      { value: 'dark', label: 'ダーク' },
    ]),
    pref(
      'view',
      'tabsAt',
      'タブの位置',
      [
        { value: 'top', label: '上' },
        { value: 'left', label: '左' },
      ],
      '左にすると、カーソルを窓の左端に寄せたときに出ます',
    ),
    pref('view', 'cardSize', 'カードの大きさ', SIZES),
    pref('view', 'sort', '一覧の並び順', [
      { value: 'moved', label: '更新順' },
      { value: 'name', label: '名前順' },
      { value: 'kind', label: '種類順' },
    ]),
    pref(
      'view',
      'hoverPreview',
      'マウスを乗せたときのプレビュー',
      'toggle',
      '動画などは、マウスを乗せると中身を再生します',
    ),
    pref('note', 'noteFont', '本文の文字の大きさ', SIZES),
    pref('note', 'noteWidth', '本文の幅', [
      { value: 'narrow', label: '狭い' },
      { value: 'normal', label: '標準' },
      { value: 'wide', label: '広い' },
    ]),
    pref('note', 'headsOpen', '見出しのカードを開いておく', 'toggle', '窓が狭いときは、閉じた状態で開きます'),
    ...grouped('ライブラリ', [
      ...(props.library !== undefined || props.onOpenLibraries
        ? [
            {
              page: 'general' as const,
              words: 'いまのライブラリ ライブラリを切り替え 場所',
              body: () => (
                <div class={styles.row}>
                  <div class={styles.what}>
                    <span class={styles.name}>いまのライブラリ</span>
                    <span class={styles.path} data-tip={props.library}>
                      {props.library ?? '未選択'}
                    </span>
                  </div>
                  <Show when={props.onOpenLibraries}>
                    <Button size="sm" onClick={() => props.onOpenLibraries?.()}>
                      切り替え
                    </Button>
                  </Show>
                </div>
              ),
            },
          ]
        : []),
      ...(props.onAppChange
        ? [
            {
              page: 'general' as const,
              words: 'ファイルを取り込むとき コピー 移動 取り込み',
              body: () => (
                <Show when={props.app} fallback={<p class={styles.loading}>読み込み中…</p>}>
                  {(a) => (
                    <For each={[failed()]}>
                      {() => (
                        <div class={styles.field}>
                          <SettingField
                            setting={{
                              key: 'importMode',
                              label: 'ファイルを取り込むとき',
                              kind: 'choice',
                              choices: [
                                { value: 'copy', label: 'コピーする' },
                                { value: 'move', label: '移動する' },
                              ],
                              default: 'copy',
                              value: a().importMode,
                              help:
                                a().importMode === 'move'
                                  ? 'ライブラリの外から落としたファイルを、ライブラリへ移します。元の場所からはなくなります'
                                  : 'ライブラリの外から落としたファイルを、ライブラリへコピーします',
                            }}
                            onChange={(v) =>
                              setApp({ importMode: v === 'move' ? 'move' : 'copy' }, '取り込み方を変えています')
                            }
                          />
                        </div>
                      )}
                    </For>
                  )}
                </Show>
              ),
            },
          ]
        : []),
    ]),
    ...(props.onAutoTagChange
      ? [
          {
            page: 'general' as const,
            group: 'AI 機能',
            words: 'AI 機能を有効化 自動分類 AI 検索 タグ 候補 モデル llama.cpp 実行環境 GPU',
            body: () => aiSettings(props.onAutoTagChange!),
          },
        ]
      : []),
    ...grouped('ストレージ', [
      ...(props.onAppChange
        ? [
            {
              page: 'general' as const,
              words: 'ストレージ サムネイルの大きさ 標準 高精細 作り直す',
              body: () => (
                <Show when={props.app}>
                  {(a) => (
                    <For each={[failed()]}>
                      {() => (
                        <div class={styles.field}>
                          <SettingField
                            setting={{
                              key: 'thumbSize',
                              label: 'サムネイルの大きさ',
                              kind: 'choice',
                              choices: [
                                { value: 'standard', label: '標準' },
                                { value: 'large', label: '高精細' },
                              ],
                              default: 'standard',
                              value: a().thumbSize,
                              help: '変えると、サムネイルを作り直します。高精細は、キャッシュがおよそ 4 倍になります',
                            }}
                            onChange={(v) =>
                              setApp(
                                { thumbSize: v === 'large' ? 'large' : 'standard' },
                                'サムネイルを作り直しています',
                              )
                            }
                          />
                        </div>
                      )}
                    </For>
                  )}
                </Show>
              ),
            },
          ]
        : []),
      ...(props.onClear
        ? [
            {
              page: 'general' as const,
              words: 'ストレージ キャッシュ インデックス サムネイル 削除',
              body: () =>
                caches(
                  props.onClear!,
                  CACHES.filter((c) => c.kind !== 'all'),
                ),
            },
          ]
        : []),
      ...(props.onRemoveUnused
        ? [
            {
              page: 'general' as const,
              words: `ストレージ 未使用のプラグイン 削除 ${(props.unused ?? []).map((p) => p.name).join(' ')}`,
              body: () => (
                <div class={styles.row}>
                  <div class={styles.what}>
                    <span class={styles.name}>未使用のプラグイン</span>
                    <span class={styles.path} data-tip={props.unused?.map((p) => p.name).join('、')}>
                      {props.unused
                        ? props.unused.length
                          ? `${props.unused.map((p) => p.name).join('、')} · ${bytesLabel(unusedBytes())}`
                          : 'ありません'
                        : '…'}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy() !== undefined || !props.unused?.length}
                    onClick={() => void run('未使用のプラグインを削除しています', props.onRemoveUnused!)}
                  >
                    削除
                  </Button>
                </div>
              ),
            },
          ]
        : []),
      ...(props.onClear
        ? [
            {
              page: 'general' as const,
              words: 'ストレージ キャッシュ すべて 削除',
              body: () =>
                caches(
                  props.onClear!,
                  CACHES.filter((c) => c.kind === 'all'),
                ),
            },
          ]
        : []),
    ]),
    ...(props.onDeveloperChange
      ? [
          {
            page: 'developer' as const,
            words: '開発者モードを有効化 開発用プラグインのフォルダ プラグインのリポジトリ 再読み込み',
            body: () => developer(props.onDeveloperChange!),
          },
        ]
      : []),
    {
      page: 'about',
      words: 'Patchouli 版 バージョン',
      body: () => (
        <div class={styles.row}>
          <span class={styles.name}>Patchouli</span>
          <span class={styles.value}>{props.version}</span>
        </div>
      ),
    },
    ...(props.loadNotices
      ? [
          {
            page: 'about' as const,
            words: '権利表示 ライセンス',
            body: () => (
              <details
                class={styles.notices}
                open={noticesOpen()}
                onToggle={(e) => setNoticesOpen(e.currentTarget.open)}
              >
                <summary>
                  <span class={styles.name}>権利表示</span>
                </summary>
                <Show when={noticesOpen()}>
                  <NoticesView notices={notices()} />
                </Show>
              </details>
            ),
          },
        ]
      : []),
  ]

  const PAGES: { id: SettingsPage; label: string }[] = [
    { id: 'general', label: '一般' },
    { id: 'view', label: '表示' },
    { id: 'note', label: 'ノート' },
    { id: 'developer', label: '開発者モード' },
    { id: 'about', label: '情報' },
  ]
  const all = createMemo(entries)
  const words = () =>
    query()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w)
  const hits = createMemo(() => {
    const ws = words()
    return all().filter((e) => {
      const t = `${PAGES.find((p) => p.id === e.page)?.label} ${e.words}`.toLowerCase()
      return ws.every((w) => t.includes(w))
    })
  })
  const pages = () => PAGES.filter((p) => hits().some((e) => e.page === p.id))
  const [picked, setPicked] = createSignal<SettingsPage>(props.page ?? 'general')
  const current = () => pages().find((p) => p.id === picked()) ?? pages()[0]
  const searching = () => words().length > 0
  const shown = () => (searching() ? pages() : current() ? [current()] : [])
  const groupsOf = (page: SettingsPage) => {
    const out: { name?: string; entries: Entry[] }[] = []
    for (const e of hits()) {
      if (e.page !== page) continue
      const last = out.at(-1)
      if (last && last.name === e.group) last.entries.push(e)
      else out.push({ name: e.group, entries: [e] })
    }
    return out
  }

  const aiSettings = (change: (on: boolean) => Promise<void>) => (
    <Show when={props.autoTag} fallback={<p class={styles.loading}>読み込み中…</p>}>
      {(a) => (
        <>
          <For each={[failed()]}>
            {() => (
              <div class={styles.field}>
                <SettingField
                  setting={{
                    key: 'autoTag',
                    label: 'AI 機能を有効化',
                    kind: 'toggle',
                    default: false,
                    value: a().enabled || downloading(),
                    help: a().installed
                      ? '自動分類と AI 検索に使用します'
                      : `自動分類と AI 検索に使用します。有効にすると、モデルと llama.cpp（${bytesLabel(a().need)}）をダウンロードします`,
                  }}
                  disabled={downloading()}
                  onChange={(v) => void changeAutoTag(change, v === true)}
                />
              </div>
            )}
          </For>
          <Show when={a().gpus}>
            {(g) => (
              <div class={`${styles.row} ${styles.sub}`}>
                <span class={styles.name}>実行環境</span>
                <span class={styles.value}>
                  {g().length ? `GPU: ${g().join('、')}` : 'CPU（GPU が見つからないため）'}
                </span>
              </div>
            )}
          </Show>
          <Show when={a().enabled && a().installed && !downloading()}>
            <For each={[failed()]}>
              {() => (
                <>
                  <Show when={props.onSuggestChange}>
                    {(set) => (
                      <div class={`${styles.field} ${styles.sub}`}>
                        <SettingField
                          setting={{
                            key: 'tagSuggest',
                            label: '自動分類',
                            kind: 'choice',
                            choices: SUGGEST.map(({ value, label }) => ({ value, label })),
                            default: 'confirm',
                            value: a().suggest,
                            help: SUGGEST.find((s) => s.value === a().suggest)?.help,
                          }}
                          onChange={(v) => {
                            const mode = SUGGEST.find((s) => s.value === v)?.value
                            if (mode) void run('自動分類を切り替えています', () => set()(mode))
                          }}
                        />
                      </div>
                    )}
                  </Show>
                  <Show when={props.onSearchChange}>
                    {(set) => (
                      <div class={`${styles.field} ${styles.sub}`}>
                        <SettingField
                          setting={{
                            key: 'contentSearch',
                            label: 'AI 検索',
                            kind: 'toggle',
                            default: true,
                            value: a().search,
                            help: '検索バーで Tab を押すと、内容で検索できます',
                          }}
                          onChange={(v) => void run('AI 検索を切り替えています', () => set()(v === true))}
                        />
                      </div>
                    )}
                  </Show>
                </>
              )}
            </For>
          </Show>
          <Show when={downloading() && !a().installed}>
            <div class={`${styles.row} ${styles.sub}`}>
              <div class={styles.what}>
                <span class={styles.name}>ダウンロード中</span>
                <span class={styles.path}>{props.autoTagProgress ? progressLabel(props.autoTagProgress) : '…'}</span>
              </div>
              <Show when={props.onCancelDownload}>
                {(cancel) => (
                  <Button size="sm" onClick={() => void cancel()()}>
                    キャンセル
                  </Button>
                )}
              </Show>
            </div>
          </Show>
        </>
      )}
    </Show>
  )

  const caches = (clear: (kind: CacheKind) => Promise<void>, list: typeof CACHES) => (
    <For each={list}>
      {(c) => (
        <div class={styles.row}>
          <div class={styles.what}>
            <span class={styles.name}>{c.label}のキャッシュ</span>
            <span class={styles.path}>{props.usage ? bytesLabel(sizeOf(props.usage, c.kind)) : '…'}</span>
          </div>
          <Button
            size="sm"
            variant={c.kind === 'all' ? 'danger' : 'default'}
            disabled={busy() !== undefined}
            onClick={() => void run(`${c.label}を削除しています`, () => clear(c.kind))}
          >
            {c.kind === 'all' ? 'すべて削除' : '削除'}
          </Button>
        </div>
      )}
    </For>
  )

  const developer = (change: (d: Developer) => Promise<void>) => (
    <Show when={props.developer} fallback={<p class={styles.loading}>読み込み中…</p>}>
      {(d) => (
        <>
          <For each={[failed()]}>
            {() => (
              <div class={styles.field}>
                <SettingField
                  setting={{
                    key: 'enabled',
                    label: '開発者モードを有効化',
                    kind: 'toggle',
                    default: false,
                    value: d().enabled,
                  }}
                  disabled={busy() !== undefined}
                  onChange={(v) =>
                    void run(v ? '開発者モードを有効にしています' : '開発者モードを無効にしています', () =>
                      change({ ...d(), enabled: v === true }),
                    )
                  }
                />
              </div>
            )}
          </For>
          <Show when={props.onReload && d().enabled}>
            <div class={styles.row}>
              <span class={styles.name}>プラグインを再読み込み</span>
              <Button size="sm" disabled={busy() !== undefined} onClick={() => props.onReload?.()}>
                再読み込み
              </Button>
            </div>
          </Show>
          <For each={['dir', 'repo'] as const}>
            {(kind) => (
              <div class={styles.places}>
                <div class={styles.placesHead}>
                  <h4 class={styles.label}>{PLACES[kind].label}</h4>
                  <Show when={props.onPickDevPath}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy() !== undefined}
                      onClick={() => void addPath(d(), kind)}
                    >
                      <Icon name="plus" size={14} withText />
                      {PLACES[kind].noun}を追加
                    </Button>
                  </Show>
                </div>
                <For
                  each={d()[PLACES[kind].key]}
                  fallback={<p class={styles.none}>{PLACES[kind].noun}が登録されていません</p>}
                >
                  {(p) => (
                    <div class={styles.place}>
                      <span class={styles.path} data-tip={p}>
                        {p}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy() !== undefined}
                        onClick={() => removePath(d(), kind, p)}
                      >
                        削除
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </>
      )}
    </Show>
  )

  return (
    <div class={styles.ov} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={styles.root} role="dialog" aria-label="設定" tabIndex={-1} ref={el}>
        <Show when={props.onClose}>
          <IconButton class={styles.x} label="閉じる" onClick={() => props.onClose?.()}>
            <Icon name="close" />
          </IconButton>
        </Show>
        <nav class={styles.side}>
          <h2>設定</h2>
          <label class={styles.search}>
            <Icon name="search" size={14} withText />
            <input
              type="search"
              placeholder="検索"
              aria-label="設定を検索"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape' || !query()) return
                e.preventDefault()
                setQuery('')
              }}
            />
          </label>
          <ScrollArea class={styles.list} viewClass={styles.listView}>
            <For each={pages()} fallback={<p class={styles.empty}>見つかりません</p>}>
              {(p) => (
                <button
                  type="button"
                  class={styles.item}
                  aria-current={!searching() && current()?.id === p.id}
                  onClick={() => {
                    setQuery('')
                    setPicked(p.id)
                  }}
                >
                  {p.label}
                </button>
              )}
            </For>
          </ScrollArea>
        </nav>
        <ScrollArea class={styles.main} viewClass={styles.mainView}>
          <Show when={busy() || error()}>
            <p class={styles.status} data-error={!!error()} role="status">
              {error() ?? `${busy()}…`}
            </p>
          </Show>
          <For each={shown()}>
            {(p) => (
              <section class={styles.page}>
                <h3 class={styles.head}>{p.label}</h3>
                <For each={groupsOf(p.id)}>
                  {(g) => (
                    <div class={styles.group}>
                      <Show when={g.name}>
                        <h4 class={styles.label}>{g.name}</h4>
                      </Show>
                      <For each={g.entries}>{(e) => e.body()}</For>
                    </div>
                  )}
                </For>
              </section>
            )}
          </For>
        </ScrollArea>
      </div>
    </div>
  )
}
