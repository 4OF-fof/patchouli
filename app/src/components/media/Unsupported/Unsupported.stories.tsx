import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Unsupported } from './Unsupported'

const done = async () => {}

const meta = {
  title: '部品/media/Unsupported',
  component: Unsupported,
  args: {
    name: 'ポスター案',
    ext: 'psd',
    label: 'PSD',
    onOpenPlugins: () => {},
    onReveal: done,
    onOpenDefault: done,
    onEnable: done,
  },
  decorators: [
    (Story) => (
      <div style={{ background: 'var(--stage)', padding: '40px 20px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Unsupported>
export default meta
type Story = StoryObj<typeof meta>

export const Unknown: Story = { name: '理由がわからない' }
export const Disabled: Story = {
  name: 'プラグインが無効',
  args: { blocker: { id: 'photoshop', name: 'Photoshop', dev: false, state: 'disabled' } },
}
export const Blocked: Story = {
  name: 'プラグインを使用できない',
  args: { blocker: { id: 'photoshop', name: 'Photoshop', dev: false, state: 'blocked' } },
}
export const Failed: Story = {
  name: '開けなかった',
  args: {
    onOpenDefault: async () => {
      throw new Error('D:素材秋の企画ポスター案.psd が見つかりません')
    },
  },
}
