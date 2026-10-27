import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, waitFor } from 'storybook/test'
import { DeveloperDialog } from './DeveloperDialog'

const DIR = 'D:\\dev\\patchouli-plugins'

const meta = {
  title: '部品/dialog/DeveloperDialog',
  component: DeveloperDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    developer: { enabled: true, pluginDir: DIR },
    onChange: fn(async () => {}),
    onPickDir: fn(async () => 'E:\\work\\plugins'),
    onReload: fn(),
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '480px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeveloperDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: '有効',
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'プラグインを再読み込み' }))
    await expect(args.onReload).toHaveBeenCalled()
  },
}

/** オフのあいだもフォルダは残し、再読み込みはできない。 */
export const Off: Story = {
  name: '無効',
  args: { developer: { enabled: false, pluginDir: DIR } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: 'プラグインを再読み込み' })).toBeDisabled()
    await userEvent.click(canvas.getByLabelText('開発者モードを有効化'))
    await expect(args.onChange).toHaveBeenCalledWith({ enabled: true, pluginDir: DIR })
  },
}

export const NoDir: Story = {
  name: 'フォルダ未選択',
  args: { developer: { enabled: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('フォルダが選択されていません')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: '選択' }))
    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith({ enabled: true, pluginDir: 'E:\\work\\plugins' }))
  },
}

export const Loading: Story = { name: '読み込み中', args: { developer: undefined } }

export const Failed: Story = {
  name: '変更に失敗',
  args: {
    developer: { enabled: false, pluginDir: 'D:\\gone' },
    onChange: fn(async () => {
      throw new Error('D:\\gone: フォルダが見つかりません')
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByLabelText('開発者モードを有効化'))
    await expect(await canvas.findByRole('status')).toHaveTextContent('フォルダが見つかりません')
  },
}
