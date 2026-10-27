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
    onClear: wait,
    onRemoveUnused: wait,
    developer: { enabled: false, pluginDirs: [], repos: [] },
    onDeveloperChange: fn(async () => {}),
    onPickDevPath: fn(async (kind: 'dir' | 'repo') => (kind === 'dir' ? DIR : REPO)),
    onRestart: fn(),
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
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('フォルダが登録されていません')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'リポジトリを追加' }))
    await waitFor(() =>
      expect(args.onDeveloperChange).toHaveBeenCalledWith({ enabled: false, pluginDirs: [], repos: [REPO] }),
    )
  },
}
export const NoUnused: Story = { name: '使っていないものがない', args: { unused: [] } }
export const Loading: Story = {
  name: '読み込み中',
  args: { usage: undefined, unused: undefined, developer: undefined },
}
/** 片付けられない環境（画面の見本など）では、版だけを出す。 */
export const VersionOnly: Story = {
  name: '版だけ',
  args: { onClear: undefined, onRemoveUnused: undefined, onDeveloperChange: undefined },
}
export const Failed: Story = {
  name: '消せなかった',
  args: {
    onClear: async () => {
      await wait()
      throw new Error('library: 別のプロセスが使用中です')
    },
  },
}

export const Developer: Story = {
  name: '開発者モード',
  args: {
    developer: { enabled: true, pluginDirs: [DIR, 'E:\\work\\plugins'], repos: [REPO] },
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '再起動' }))
    await expect(args.onRestart).toHaveBeenCalled()
  },
}

/** 設定を変えたあとは、再起動するまで使われないことを知らせる。 */
export const RestartNeeded: Story = {
  name: '再起動が必要',
  args: {
    developer: { enabled: true, pluginDirs: [DIR], repos: [] },
    restartNeeded: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('変更を反映するには再起動が必要です')).toBeInTheDocument()
  },
}

export const DeveloperFailed: Story = {
  name: '開発者モードの変更に失敗',
  args: {
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
