import { type Component, For, type JSX, Show, createMemo, createResource, createSignal } from 'solid-js'
import type {
  AppSettings,
  AutoTag,
  AutoTagProgress,
  CacheKind,
  CacheUsage,
  Developer,
  RemoteActions,
  RemoteStatus,
  TagSuggest,
  UnusedPlugin,
} from '../../../backend/types'
import type { ColorScheme } from '../../../model/colorScheme'
import { DEFAULT_PREFS, type Prefs, type ScreenStart, themeOf } from '../../../model/prefs'
import { ScrollArea } from '../../base/ScrollArea/ScrollArea'
import { Button } from '../../controls/Button/Button'
import { SettingField } from '../../controls/SettingField/SettingField'
import { type Notices, NoticesView } from './Notices'
import {
  AppClientSetting,
  CliAccessSetting,
  CliPathSetting,
  ExtensionSetting,
  type RemoteSettingsProps,
  SkillSetting,
} from './RemoteSettings'
import { SchemeEditor } from './SchemeEditor'
import { DialogFrame } from '../DialogFrame/DialogFrame'
import styles from './SettingsDialog.module.css'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'
import { createBusy, message } from '../../../model/busy'

export type SettingsPage = 'general' | 'view' | 'colors' | 'note' | 'connectors' | 'developer' | 'about'

export interface SettingsDialogProps {
  version: string
  /** 開いたときに出すページ。 */
  page?: SettingsPage
  prefs?: Prefs
  onPrefsChange?: (patch: Partial<Prefs>) => void
  /** 起動時に開く画面に選べる、プラグインの画面。 */
  screens?: { value: ScreenStart; label: string }[]
  /** 自分で作った配色。 */
  schemes?: ColorScheme[]
  onSchemesChange?: (list: ColorScheme[]) => void
  /** ファイルに書き出し、書き出した場所を返す。選ぶのをやめたら undefined。 */
  onExportFile?: (name: string, data: string) => Promise<string | undefined>
  /** いま開いているライブラリの場所。 */
  library?: string
  onOpenLibraries?: () => void
  app?: AppSettings
  onAppChange?: (s: AppSettings) => Promise<void>
  /** スタートアップで起動するか。自動起動を扱えない環境では undefined。 */
  startup?: boolean
  onStartupChange?: (on: boolean) => Promise<void>
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
  remote?: RemoteStatus
  remoteActions?: RemoteActions
  /** コネクタの設定を変えたあとに、状態を読み直す。 */
  onRemoteChanged?: () => Promise<void>
  /** 権利表示を読む。一覧が大きいので、開いたときに読む。 */
  loadNotices?: () => Promise<Notices>
  onClose?: () => void
}

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
  const { busy, error, setError, run } = createBusy()
  const [query, setQuery] = createSignal('')
  const [done, setDone] = createSignal<string>()

  const [switching, setSwitching] = createSignal(false)
  const changeAutoTag = async (change: (on: boolean) => Promise<void>, on: boolean) => {
    setSwitching(true)
    setError(undefined)
    try {
      await change(on)
    } catch (e) {
      setError(message(e))
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
    return a && change ? run(label, () => change({ ...a, ...patch })) : undefined
  }

  // 値が変わるたびに項目を作り直すと切り替えた直後にスイッチのフォーカスが外れる
  const startupAvailable = createMemo(() => props.startup !== undefined)

  const remotePart = (actions: RemoteActions, Part: Component<RemoteSettingsProps>, first?: boolean) => () => (
    <Show when={props.remote} fallback={first && <p class={styles.loading}>読み込み中…</p>}>
      {(s) => (
        <Part
          status={s()}
          actions={actions}
          busy={busy() !== undefined}
          run={run}
          onChanged={async () => await props.onRemoteChanged?.()}
        />
      )}
    </Show>
  )
  const connectors = (actions: RemoteActions): Entry[] => [
    ...grouped('CLI', [
      {
        page: 'connectors',
        words: 'CLI コマンド PATH に登録 解除 端末',
        body: remotePart(actions, CliPathSetting, true),
      },
      {
        page: 'connectors',
        words: 'CLI skill SKILL.md AI エージェント インストール 更新 削除 フォルダを選択',
        body: remotePart(actions, SkillSetting),
      },
      { page: 'connectors', words: 'CLI 接続の許可 権限 拒否 削除', body: remotePart(actions, CliAccessSetting) },
    ]),
    ...grouped('外部アプリ', [
      {
        page: 'connectors',
        words: '外部アプリ ブラウザの拡張機能 Native Messaging ID ホスト名',
        body: remotePart(actions, ExtensionSetting),
      },
      {
        page: 'connectors',
        words: `外部アプリ 接続したアプリ 権限 許可 拒否 削除 ${(props.remote?.clients ?? []).map((c) => c.name).join(' ')}`,
        body: remotePart(actions, AppClientSetting),
      },
    ]),
  ]

  const entries = (): Entry[] => [
    ...grouped('起動', [
      pref('general', 'start', '起動時に開く画面', [
        { value: 'last', label: '前回のタブ' },
        { value: 'home', label: 'ホーム' },
        ...(props.screens ?? []),
      ]),
      pref(
        'general',
        'openLink',
        'リンクの開き方',
        [
          { value: 'peek', label: '重ねて表示' },
          { value: 'here', label: '現在のタブ' },
          { value: 'tab', label: '新しいタブ' },
        ],
        'ノート内のリンクをクリックしたときの動作です。中クリックでは常に新しいタブで開きます',
      ),
      ...(props.onAppChange
        ? [
            {
              page: 'general' as const,
              words: 'ウィンドウを閉じたとき タスクトレイに残す 終了 常駐',
              body: () => (
                <Show when={props.app}>
                  {(a) => (
                    <div class={styles.field}>
                      <SettingField
                        setting={{
                          key: 'closeToTray',
                          label: 'ウィンドウを閉じたとき',
                          kind: 'choice',
                          choices: [
                            { value: 'tray', label: 'タスクトレイに残す' },
                            { value: 'quit', label: '終了' },
                          ],
                          default: 'tray',
                          value: a().closeToTray ? 'tray' : 'quit',
                          help: a().closeToTray
                            ? 'ウィンドウを閉じても、CLI や拡張機能からの操作を受け付けます。終了するときは、タスクトレイのメニューから選択します'
                            : 'ウィンドウを閉じると、アプリを終了します',
                        }}
                        onChange={(v) =>
                          setApp({ closeToTray: v !== 'quit' }, 'ウィンドウを閉じたときの動作を変更しています')
                        }
                      />
                    </div>
                  )}
                </Show>
              ),
            },
          ]
        : []),
      ...(startupAvailable() && props.onStartupChange
        ? [
            {
              page: 'general' as const,
              words: 'スタートアップで起動 ログイン 自動起動 タスクトレイ 常駐',
              body: () => (
                <div class={styles.field}>
                  <SettingField
                    setting={{
                      key: 'startup',
                      label: 'スタートアップで起動',
                      kind: 'toggle',
                      default: false,
                      value: props.startup ?? false,
                      help: 'ログイン時に、ウィンドウを開かずにタスクトレイに常駐して起動します',
                    }}
                    disabled={busy() !== undefined}
                    onChange={(v) =>
                      run('スタートアップの設定を変更しています', () => props.onStartupChange!(v === true))
                    }
                  />
                </div>
              ),
            },
          ]
        : []),
    ]),
    pref('view', 'theme', 'テーマ', [
      { value: 'system', label: 'システムに合わせる' },
      { value: 'light', label: 'ライト' },
      { value: 'dark', label: 'ダーク' },
    ]),
    ...(props.onSchemesChange
      ? [
          {
            page: 'colors' as const,
            words: '配色 カラースキーマ 色 新規作成 複製 読み込み 書き出し JSON',
            body: () => (
              <SchemeEditor
                schemes={props.schemes ?? []}
                value={prefs().scheme}
                theme={themeOf(prefs())}
                onSelect={(scheme) => props.onPrefsChange?.({ scheme })}
                onSchemesChange={props.onSchemesChange!}
                onExport={props.onExportFile}
                onMessage={(m) => {
                  setError(m.error)
                  setDone(m.done)
                }}
              />
            ),
          },
        ]
      : []),
    pref(
      'view',
      'tabsAt',
      'タブの位置',
      [
        { value: 'top', label: '上' },
        { value: 'left', label: '左' },
      ],
      '左にすると、ウィンドウの左端にカーソルを合わせたときに表示されます',
    ),
    pref('view', 'cardSize', 'カードの大きさ', SIZES),
    pref('view', 'sort', '一覧の並び順', [
      { value: 'moved', label: '更新順' },
      { value: 'name', label: '名前順' },
      { value: 'kind', label: '種類順' },
    ]),
    pref('view', 'hoverPreview', 'ホバー再生', 'toggle', '動画や音声のサムネイルにカーソルを合わせると再生します'),
    pref('view', 'hoverSound', 'ホバー再生の音声', 'toggle', 'ホバー再生時に音声を出力します'),
    pref('note', 'noteFont', '本文の文字サイズ', SIZES),
    pref('note', 'noteWidth', '本文の幅', [
      { value: 'narrow', label: '狭い' },
      { value: 'normal', label: '標準' },
      { value: 'wide', label: '広い' },
    ]),
    pref('note', 'headsOpen', '見出しを常に表示', 'toggle', '画面幅が狭いときは、閉じた状態で開きます'),
    ...grouped('ライブラリ', [
      ...(props.library !== undefined || props.onOpenLibraries
        ? [
            {
              page: 'general' as const,
              words: '現在のライブラリ ライブラリを切り替え 場所',
              body: () => (
                <div class={styles.row}>
                  <div class={styles.what}>
                    <span class={styles.name}>現在のライブラリ</span>
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
              words: 'ファイルの取り込み方法 コピー 移動 取り込み',
              body: () => (
                <Show when={props.app} fallback={<p class={styles.loading}>読み込み中…</p>}>
                  {(a) => (
                    <div class={styles.field}>
                      <SettingField
                        setting={{
                          key: 'importMode',
                          label: 'ファイルの取り込み方法',
                          kind: 'choice',
                          choices: [
                            { value: 'copy', label: 'コピー' },
                            { value: 'move', label: '移動' },
                          ],
                          default: 'copy',
                          value: a().importMode,
                          help:
                            a().importMode === 'move'
                              ? 'ライブラリの外からドロップしたファイルを、ライブラリへ移動します。元の場所には残りません'
                              : 'ライブラリの外からドロップしたファイルを、ライブラリへコピーします',
                        }}
                        onChange={(v) =>
                          setApp({ importMode: v === 'move' ? 'move' : 'copy' }, '取り込み方法を変更しています')
                        }
                      />
                    </div>
                  )}
                </Show>
              ),
            },
            {
              page: 'general' as const,
              words: 'URL の開き方 内蔵ブラウザ 既定のアプリ ブラウザ',
              body: () => (
                <Show when={props.app}>
                  {(a) => (
                    <div class={styles.field}>
                      <SettingField
                        setting={{
                          key: 'linkOpen',
                          label: 'URL の開き方',
                          kind: 'choice',
                          choices: [
                            { value: 'default', label: '既定のアプリ' },
                            { value: 'builtin', label: '内蔵ブラウザ' },
                          ],
                          default: 'default',
                          value: a().linkOpen,
                          help:
                            a().linkOpen === 'builtin'
                              ? 'ノート内の URL を Ctrl+クリックしたとき、アプリ内の新しいタブで開きます'
                              : 'ノート内の URL を Ctrl+クリックしたとき、既定のブラウザで開きます',
                        }}
                        onChange={(v) =>
                          setApp({ linkOpen: v === 'builtin' ? 'builtin' : 'default' }, 'URL の開き方を変更しています')
                        }
                      />
                    </div>
                  )}
                </Show>
              ),
            },
            {
              page: 'general' as const,
              words: '音声 波形の作成時間の上限 秒',
              body: () => (
                <Show when={props.app}>
                  {(a) => (
                    <div class={styles.field}>
                      <SettingField
                        setting={{
                          key: 'waveLimit',
                          label: '波形の作成時間の上限（秒）',
                          kind: 'number',
                          min: 0,
                          step: 1,
                          default: 60,
                          value: a().waveLimit,
                          help: '0 にすると、上限なしで最後まで作成します',
                        }}
                        onChange={(v) =>
                          typeof v === 'number' && v >= 0
                            ? setApp({ waveLimit: Math.round(v) }, '波形の作成時間の上限を変更しています')
                            : undefined
                        }
                      />
                    </div>
                  )}
                </Show>
              ),
            },
            {
              page: 'general' as const,
              words: '音声 サムネイル ジャケットとして適用 タグ 埋め込み',
              body: () => (
                <Show when={props.app}>
                  {(a) => (
                    <div class={styles.field}>
                      <SettingField
                        setting={{
                          key: 'thumbAsJacket',
                          label: 'ジャケットとして適用',
                          kind: 'toggle',
                          default: true,
                          value: a().thumbAsJacket,
                          help: '音声のサムネイルを変更すると、ジャケットにも適用します。MP3・FLAC はファイルのタグに画像を書き込みます',
                        }}
                        onChange={(v) => setApp({ thumbAsJacket: v === true }, 'ジャケットの適用設定を変更しています')}
                      />
                    </div>
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
                    <div class={styles.field}>
                      <SettingField
                        setting={{
                          key: 'thumbSize',
                          label: 'サムネイルの画質',
                          kind: 'choice',
                          choices: [
                            { value: 'standard', label: '標準' },
                            { value: 'large', label: '高精細' },
                          ],
                          default: 'standard',
                          value: a().thumbSize,
                          help: '変更すると、サムネイルを再作成します。高精細ではキャッシュの容量が約 4 倍になります',
                        }}
                        onChange={(v) =>
                          setApp({ thumbSize: v === 'large' ? 'large' : 'standard' }, 'サムネイルを再作成しています')
                        }
                      />
                    </div>
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
                          : 'なし'
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
    ...(props.remoteActions ? connectors(props.remoteActions) : []),
    ...(props.onDeveloperChange
      ? [
          {
            page: 'developer' as const,
            words: '開発者モードを有効化 開発用プラグインのフォルダ プラグインのリポジトリ 再読み込み',
            body: () => developer(props.onDeveloperChange!),
          },
        ]
      : []),
    ...grouped('Patchouli', [
      {
        page: 'about',
        words: 'Patchouli バージョン',
        body: () => (
          <div class={styles.row}>
            <span class={styles.name}>バージョン</span>
            <span class={styles.value}>{props.version}</span>
          </div>
        ),
      },
      ...(props.loadNotices
        ? [
            {
              page: 'about' as const,
              words: '権利表示 ライセンス 使用しているソフトウェア',
              body: () => <NoticesView notices={notices()} />,
            },
          ]
        : []),
    ]),
  ]

  const PAGES: { id: SettingsPage; label: string }[] = [
    { id: 'general', label: '一般' },
    { id: 'view', label: '表示' },
    { id: 'colors', label: '配色' },
    { id: 'note', label: 'ノート' },
    { id: 'connectors', label: 'コネクタ' },
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
  const [notices] = createResource(
    () => (shown().some((p) => p.id === 'about') && props.loadNotices) || undefined,
    (load) => load(),
  )
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
              onChange={(v) => changeAutoTag(change, v === true)}
            />
          </div>
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
                        return mode && run('自動分類を切り替えています', () => set()(mode))
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
                        help: '検索バーの先頭に「?」を入力すると、内容で検索できます',
                      }}
                      onChange={(v) => run('AI 検索を切り替えています', () => set()(v === true))}
                    />
                  </div>
                )}
              </Show>
            </>
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
            onClick={() => void run(`${c.label}のキャッシュを削除しています`, () => clear(c.kind))}
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
                run(v ? '開発者モードを有効にしています' : '開発者モードを無効にしています', () =>
                  change({ ...d(), enabled: v === true }),
                )
              }
            />
          </div>
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
    <DialogFrame label="設定" overlayClass={styles.ov} class={styles.root} onClose={props.onClose}>
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
          <For each={pages()} fallback={<p class={styles.empty}>一致する項目がありません</p>}>
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
        <Show when={busy() || error() || done()}>
          <p class={styles.status} data-error={!!error()} role="status">
            {error() ?? (busy() ? `${busy()}…` : done())}
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
    </DialogFrame>
  )
}
