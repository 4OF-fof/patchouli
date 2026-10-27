import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn } from 'storybook/test'
import { builtinReport } from '../../../plugins/builtin'
import type { CommandStatus, PluginReport, PluginStatus, SettingValue } from '../../../plugins/types'
import { sampleReport } from '../../../samples/plugins'
import { PluginsDialog } from './PluginsDialog'

const ffmpeg: CommandStatus = { name: 'ffmpeg', path: 'C:\\Users\\me\\scoop\\shims\\ffmpeg.exe' }
const none = { commands: {}, plugins: {} }

/** 外から入れたプラグイン。組み込み UI と設定を持ち、あれば pandoc を使う。 */
const text: PluginStatus = {
  id: 'example.text',
  name: 'テキスト',
  version: '0.1.0',
  recorded: '0.1.0',
  source: { local: 'D:\\plugins\\patchouli-text' },
  description: 'テキストファイルの表示とサムネイル生成',
  builtin: false,
  dev: false,
  enabled: true,
  state: 'active',
  required: none,
  optional: { commands: { pandoc: {} }, plugins: {} },
  via: [],
  caps: [
    { part: 'thumbnail', by: 'ui' },
    { part: 'view', by: 'ui' },
  ],
  formats: ['log', 'txt'],
  settings: [
    { key: 'wrap', label: '行を折り返す', kind: 'toggle', default: true, value: true },
    { key: 'size', label: '文字サイズ', kind: 'number', min: 10, max: 32, step: 1, default: 14, value: 14 },
    {
      key: 'font',
      label: 'フォント',
      help: '詳細表示で使用するフォント',
      kind: 'choice',
      choices: [
        { value: 'mono', label: '等幅' },
        { value: 'sans', label: 'ゴシック' },
      ],
      default: 'mono',
      value: 'mono',
    },
  ],
  problems: [{ level: 'warning', text: '外部ツール「pandoc」が見つからないため、一部の機能を利用できません' }],
}

const found: PluginReport = {
  plugins: [...builtinReport().plugins, text],
  commands: [ffmpeg, { name: 'pandoc' }],
}

const external: PluginReport = {
  commands: [ffmpeg],
  plugins: [
    ...builtinReport().plugins,
    {
      ...text,
      optional: none,
      version: '0.1.0',
      recorded: '0.2.0',
      problems: [
        { level: 'warning', text: 'インストール済みのバージョン（0.1.0）がライブラリの記録（0.2.0）と異なります' },
      ],
    },
    {
      id: 'example.psd',
      name: 'example.psd',
      recorded: '1.2.0',
      source: { local: 'D:\\plugins\\psd.zip' },
      description: '',
      builtin: false,
      dev: false,
      enabled: true,
      state: 'missing',
      required: none,
      optional: none,
      via: [],
      caps: [],
      formats: [],
      settings: [],
      problems: [{ level: 'error', text: 'この端末にインストールされていません' }],
    },
  ],
}

/** コマンドとプラグインが足りないとき。必須のものが足りない Photoshop は読み込まない。 */
const troubled: PluginReport = {
  commands: [{ name: 'ffmpeg' }, { name: 'magick' }],
  plugins: [
    ...builtinReport().plugins.map((p) => ({
      ...p,
      problems: p.optional.commands?.ffmpeg
        ? [
            {
              level: 'warning' as const,
              text: '外部ツール「ffmpeg」が見つからないため、一部の機能を利用できません',
            },
          ]
        : [],
    })),
    {
      id: 'example.photoshop',
      name: 'Photoshop',
      version: '1.2.0',
      recorded: '1.2.0',
      source: { local: 'D:\\plugins\\psd' },
      description: 'PSD ファイルのサムネイル生成',
      builtin: false,
      dev: false,
      enabled: true,
      state: 'blocked',
      required: {
        commands: { magick: { min: '7.0' } },
        plugins: { 'patchouli.image': {}, 'example.layers': { min: '0.2.0' } },
      },
      optional: none,
      via: [{ name: 'ffmpeg', plugin: '画像', required: true }],
      caps: [{ part: 'thumbnail', by: 'wasm' }],
      formats: [],
      settings: [],
      problems: [
        { level: 'error', text: '必須の外部ツール「magick」が見つかりません' },
        {
          level: 'error',
          text: '必須プラグイン「example.layers」が有効ではありません',
        },
      ],
    },
  ],
}

const wait = () => new Promise<void>((r) => setTimeout(r, 600))
const actions = {
  install: async () => {
    await wait()
    return true
  },
  update: wait,
  remove: wait,
  setSetting: wait,
  setEnabled: wait,
}

/** 開発者モードのフォルダの中のもの。テキストは通常版も入っていて、開発版のほうを使う。CSV は検出した直後で無効。 */
const developing: PluginReport = {
  commands: [ffmpeg],
  plugins: [
    ...builtinReport().plugins,
    {
      ...text,
      optional: none,
      version: '0.3.0-dev',
      recorded: undefined,
      source: undefined,
      dev: true,
      problems: [],
    },
    {
      ...text,
      optional: none,
      state: 'disabled',
      settings: [],
      problems: [{ level: 'warning', text: '同じ ID の開発版を使用しているため、使用していません' }],
    },
    {
      id: 'example.csv',
      name: 'CSV',
      version: '0.1.0',
      description: 'CSV の表の表示とサムネイル生成',
      builtin: false,
      dev: true,
      enabled: false,
      state: 'disabled',
      required: none,
      optional: none,
      via: [],
      caps: [
        { part: 'thumbnail', by: 'ui' },
        { part: 'view', by: 'ui' },
      ],
      formats: ['csv'],
      settings: [],
      problems: [],
    },
  ],
}

const meta = {
  title: '部品/dialog/PluginsDialog',
  component: PluginsDialog,
  parameters: { layout: 'fullscreen' },
  args: { report: found, actions, onClose: () => {} },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '640px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginsDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const External: Story = { name: '更新・未導入', args: { report: external } }
export const Problems: Story = { name: 'エラーと警告', args: { report: troubled } }
export const Failed: Story = {
  name: '入れられなかった',
  args: {
    actions: {
      ...actions,
      install: async () => {
        await wait()
        throw new Error('plugin.json が見つかりません')
      },
    },
  },
}
/** 設定を変えると、アプリと同じように一覧を読み直す（中身は同じでも、別のものになる）。 */
export const Refresh: Story = {
  name: '設定を変えて読み直す',
  render: (args) => {
    const values = new Map<string, SettingValue>()
    const load = (): PluginReport => ({
      ...found,
      plugins: found.plugins.map((p) => ({
        ...p,
        settings: p.settings.map((x) => ({ ...x, value: values.get(`${p.id}/${x.key}`) ?? x.value })),
      })),
    })
    const [report, setReport] = createSignal(load())
    return (
      <PluginsDialog
        {...args}
        report={report()}
        actions={{
          ...actions,
          setSetting: async (id, key, value) => {
            await wait()
            values.set(`${id}/${key}`, value)
          },
        }}
        onRefresh={() => setReport(load())}
      />
    )
  },
}
export const Developing: Story = {
  name: '開発版',
  args: { report: developing, actions: { ...actions, setEnabled: fn(async () => {}) } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'CSV' }))
    await userEvent.click(await canvas.findByRole('button', { name: '有効化' }))
    await expect(args.actions?.setEnabled).toHaveBeenCalledWith('example.csv', true, true)
  },
}
/** 無効にした通常のプラグイン。 */
export const Disabled: Story = {
  name: '無効にしたもの',
  args: { report: { ...found, plugins: [...builtinReport().plugins, { ...text, state: 'disabled', enabled: false }] } },
}
export const Sample: Story = { name: '見本（例のプラグインも）', args: { report: sampleReport(), actions: {} } }
export const Loading: Story = { name: '読み込み中', args: { report: undefined } }
