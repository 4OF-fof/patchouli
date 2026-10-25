import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { builtinReport } from '../../../plugins/builtin'
import type { PluginReport, PluginStatus } from '../../../plugins/types'
import { PluginsDialog } from './PluginsDialog'

const ffmpeg = { path: 'C:\\Users\\me\\scoop\\shims\\ffmpeg.exe', version: '7.1' }

/** 外から入れたプラグイン。iframe の画面と設定を持つ。 */
const text: PluginStatus = {
  id: 'example.text',
  name: 'テキスト',
  version: '0.1.0',
  recorded: '0.1.0',
  source: { local: 'D:\\plugins\\patchouli-text' },
  description: 'テキストファイルを詳細で読む',
  builtin: false,
  state: 'active',
  ffmpeg: 'none',
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
  problems: [],
}

const found: PluginReport = { plugins: [...builtinReport().plugins, text], ffmpeg }

const external: PluginReport = {
  ffmpeg,
  plugins: [
    ...builtinReport().plugins,
    {
      ...text,
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
      ffmpeg: 'none',
      formats: [],
      settings: [],
      problems: [{ level: 'error', text: 'アプリに入っていない。取得先から入れるまで使えない' }],
    },
    {
      id: 'example.model',
      name: '3D モデル',
      version: '0.3.1',
      source: { local: 'D:\\plugins\\model.zip' },
      description: 'glTF をくるくる回して見る',
      builtin: false,
      state: 'unused',
      ffmpeg: 'none',
      formats: ['glb', 'gltf'],
      settings: [],
      problems: [],
    },
  ],
}

/** FFmpeg がなく、形式を取り合っているとき。 */
const troubled: PluginReport = {
  ffmpeg: null,
  plugins: [
    ...builtinReport().plugins.map((p) =>
      p.ffmpeg === 'optional'
        ? {
            ...p,
            problems: [
              {
                level: 'warning' as const,
                text: 'FFmpeg が見つからないので、OS の機能で代わりにする。読めない形式がある',
              },
            ],
          }
        : p.id === 'patchouli.image'
          ? {
              ...p,
              problems: [
                { level: 'error' as const, text: '「psd」を「Photoshop」も受け持とうとしている。こちらを使う' },
              ],
            }
          : p,
    ),
    {
      id: 'example.photoshop',
      name: 'Photoshop',
      version: '1.2.0',
      recorded: '1.2.0',
      source: { local: 'D:\\plugins\\psd' },
      description: 'PSD のレイヤーを重ねたサムネイル',
      builtin: false,
      state: 'active',
      ffmpeg: 'required',
      formats: [],
      settings: [],
      problems: [
        { level: 'error', text: '「psd」はもう「画像」が受け持っているので、受け持てない' },
        { level: 'error', text: 'FFmpeg が見つからない。FFmpeg を入れるまで、このプラグインは動かない' },
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
  use: wait,
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
export const External: Story = { name: '更新・未導入・未使用', args: { report: external } }
export const Problems: Story = { name: 'エラーと警告', args: { report: troubled } }
export const Failed: Story = {
  name: '入れられなかった',
  args: {
    actions: {
      ...actions,
      install: async () => {
        await wait()
        throw new Error('someone/patchouli-text: 最新のリリースに zip がない')
      },
    },
  },
}
export const Sample: Story = { name: '見本（組み込みだけ）', args: { report: builtinReport(), actions: {} } }
export const Loading: Story = { name: '読み込み中', args: { report: undefined } }
