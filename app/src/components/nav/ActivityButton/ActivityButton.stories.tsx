import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ActivityButton } from './ActivityButton'

const meta = {
  title: '部品/nav/ActivityButton',
  component: ActivityButton,
  args: {
    activities: [
      { key: 'thumbs', icon: 'image', label: 'サムネイルと波形を作成中', done: 28, total: 40 },
      { key: 'import', icon: 'import', label: '取り込み中' },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', 'justify-content': 'flex-end', width: '360px', height: '160px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityButton>
export default meta
type Story = StoryObj<typeof meta>

export const Busy: Story = { name: '処理中' }
export const Open: Story = { name: '一覧を開いた', args: { open: true } }
export const Idle: Story = { name: '何も動いていない', args: { activities: [] } }
