import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { builtinReport } from '../../../plugins/builtin'
import type { CommandStatus, PluginReport, PluginStatus, SettingValue } from '../../../plugins/types'
import { sampleReport } from '../../../samples/plugins'
import { PluginsDialog } from './PluginsDialog'

const ffmpeg: CommandStatus = { name: 'ffmpeg', path: 'C:\\Users\\me\\scoop\\shims\\ffmpeg.exe' }
const none = { commands: [], plugins: [] }

/** 外から入れたプラグイン。組み込み UI と設定を持ち、あれば pandoc を使う。 */
const text: PluginStatus = {
  id: 'example.text',
  name: 'テキスト',
  version: '0.1.0',
  recorded: '0.1.0',
  source: { local: 'D:\\plugins\\patchouli-text' },
  description: 'テキストファイルを詳細で読む',
  builtin: false,
  state: 'active',
  required: none,
  optional: { commands: ['pandoc'], plugins: [] },
  caps: [
    { part: 'thumbnail', by: 'ui' },
    { part: 'view', by: 'ui' },
  ],
  formats: ['log', 'txt'],
  settings: [
    { key: 'wrap', label: '折り返す', kind: 'toggle', default: true, value: true },
    { key: 'size', label: '文字の大きさ', kind: 'number', min: 10, max: 32, step: 1, default: 14, value: 14 },
    {
      key: 'font',
      label: '字体',
      help: '詳細の画面で使う字体',
      kind: 'choice',
      choices: [
        { value: 'mono', label: '等幅' },
        { value: 'sans', label: 'ゴシック' },
      ],
      default: 'mono',
      value: 'mono',
    },
  ],
  problems: [{ level: 'warning', text: 'pandoc が見つからないので、pandoc を使わずに動かす。できないことがある' }],
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
      problems: [{ level: 'warning', text: 'ライブラリには 0.2.0 が記録されているが、アプリに入っているのは 0.1.0' }],
    },
    {
      id: 'example.psd',
      name: 'example.psd',
      recorded: '1.2.0',
      source: { local: 'D:\\plugins\\psd.zip' },
      description: '',
      builtin: false,
      state: 'missing',
      required: none,
      optional: none,
      caps: [],
      formats: [],
      settings: [],
      problems: [{ level: 'error', text: 'アプリに入っていない。取得先から入れるまで使えない' }],
    },
  ],
}

/** コマンドとプラグインが足りず、形式を取り合っているとき。 */
const troubled: PluginReport = {
  commands: [{ name: 'ffmpeg' }, { name: 'magick' }],
  plugins: [
    ...builtinReport().plugins.map((p) => ({
      ...p,
      problems: [
        ...(p.optional.commands?.includes('ffmpeg')
          ? [
              {
                level: 'warning' as const,
                text: 'ffmpeg が見つからないので、ffmpeg を使わずに動かす。できないことがある',
              },
            ]
          : []),
        ...(p.id === 'patchouli.image'
          ? [{ level: 'error' as const, text: '「psd」を「Photoshop」も受け持とうとしている。こちらを使う' }]
          : []),
      ],
    })),
    {
      id: 'example.photoshop',
      name: 'Photoshop',
      version: '1.2.0',
      recorded: '1.2.0',
      source: { local: 'D:\\plugins\\psd' },
      description: 'PSD のレイヤーを重ねたサムネイル',
      builtin: false,
      state: 'active',
      required: { commands: ['magick'], plugins: ['patchouli.image', 'example.layers'] },
      optional: none,
      caps: [{ part: 'thumbnail', by: 'wasm' }],
      formats: [],
      settings: [],
      problems: [
        { level: 'error', text: '「psd」はもう「画像」が受け持っているので、受け持てない' },
        { level: 'error', text: 'magick が見つからない。magick を入れるまで、このプラグインは動かない' },
        {
          level: 'error',
          text: 'プラグイン example.layers を使っていない。このライブラリで使うまで、このプラグインは動かない',
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
}

const meta = {
  title: '部品/overlay/PluginsDialog',
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
        throw new Error('plugin.json が見つからない')
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
export const Sample: Story = { name: '見本（例のプラグインも）', args: { report: sampleReport(), actions: {} } }
export const Loading: Story = { name: '読み込み中', args: { report: undefined } }
