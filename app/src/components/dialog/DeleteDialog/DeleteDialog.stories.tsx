import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DeleteDialog } from './DeleteDialog'

const meta = {
  title: '部品/dialog/DeleteDialog',
  component: DeleteDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'moodboard-01',
    onDelete: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '360px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeleteDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Note: Story = { name: 'ノート', args: { name: '配色メモ：秋の企画', note: true } }
