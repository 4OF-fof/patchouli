import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, waitFor } from 'storybook/test'
import { SettingsDialog } from './SettingsDialog'

const wait = () => new Promise<void>((r) => setTimeout(r, 600))

const DIR = 'D:\\dev\\patchouli-plugins'
const REPO = 'D:\\dev\\patchouli-csv-plugin'

const meta = {
  title: '部品/dialog/SettingsDialog',
  component: SettingsDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    version: '0.1.0',
    usage: { library: 1_240_000, thumbs: 86_500_000 },
    unused: [
      { id: 'example.psd', name: 'Photoshop', version: '1.2.0', bytes: 2_310_000 },
      { id: 'example.heic', name: 'HEIC', version: '0.3.1', bytes: 845_000 },
    ],
    autoTag: {
      enabled: false,
      installed: false,
      downloading: false,
      need: 864_676_512,
      suggest: 'confirm',
      search: true,
    },
    onAutoTagChange: wait,
    onCancelDownload: wait,
    onSuggestChange: wait,
    onSearchChange: wait,
    onClear: wait,
    onRemoveUnused: wait,
    developer: { enabled: false, pluginDirs: [], repos: [] },
    onDeveloperChange: fn(async () => {}),
    onPickDevPath: fn(async (kind: 'dir' | 'repo') => (kind === 'dir' ? DIR : REPO)),
    onReload: fn(),
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '720px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { page: 'developer' },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('フォルダが登録されていません')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'リポジトリを追加' }))
    await waitFor(() =>
      expect(args.onDeveloperChange).toHaveBeenCalledWith({ enabled: false, pluginDirs: [], repos: [REPO] }),
    )
  },
}
export const NoUnused: Story = { name: '使っていないものがない', args: { page: 'storage', unused: [] } }
export const Loading: Story = {
  name: '読み込み中',
  args: { page: 'storage', usage: undefined, unused: undefined, developer: undefined },
}
export const VersionOnly: Story = {
  name: '版だけ',
  args: { onClear: undefined, onRemoveUnused: undefined, onDeveloperChange: undefined },
}
export const Failed: Story = {
  name: '消せなかった',
  args: {
    page: 'storage',
    onClear: async () => {
      await wait()
      throw new Error('library: 別のプロセスが使用中です')
    },
  },
}

export const Developer: Story = {
  name: '開発者モード',
  args: {
    page: 'developer',
    developer: { enabled: true, pluginDirs: [DIR, 'E:\\work\\plugins'], repos: [REPO] },
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'プラグインを再読み込み' }))
    await expect(args.onReload).toHaveBeenCalled()
  },
}

export const DeveloperFailed: Story = {
  name: '開発者モードの変更に失敗',
  args: {
    page: 'developer',
    onDeveloperChange: fn(async () => {
      throw new Error('settings.json: アクセスが拒否されました')
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByLabelText('開発者モードを有効化'))
    await expect(await canvas.findByRole('status')).toHaveTextContent('アクセスが拒否されました')
    await expect(canvas.getByLabelText('開発者モードを有効化')).not.toBeChecked()
  },
}
export const AutoTagDownloading: Story = {
  name: 'AI 機能をダウンロード中',
  args: {
    page: 'ai',
    autoTag: {
      enabled: false,
      installed: false,
      downloading: true,
      need: 864_676_512,
      suggest: 'confirm',
      search: true,
    },
    autoTagProgress: { file: 'embeddinggemma-2-Q8_0.gguf', done: 312_000_000, total: 829_000_000 },
  },
}
export const AutoTagGpu: Story = {
  name: 'AI 機能が有効（GPU）',
  args: {
    page: 'ai',
    autoTag: {
      enabled: true,
      installed: true,
      downloading: false,
      need: 0,
      gpus: ['NVIDIA GeForce RTX 4070'],
      suggest: 'confirm',
      search: true,
    },
  },
}
export const AutoTagCpu: Story = {
  name: 'AI 機能が有効（CPU）',
  args: {
    page: 'ai',
    autoTag: {
      enabled: true,
      installed: true,
      downloading: false,
      need: 0,
      gpus: [],
      suggest: 'confirm',
      search: true,
    },
  },
}
