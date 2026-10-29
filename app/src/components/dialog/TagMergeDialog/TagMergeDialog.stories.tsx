import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TagMergeDialog } from './TagMergeDialog'

const meta = {
  title: '部品/dialog/TagMergeDialog',
  component: TagMergeDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    from: '写真/街',
    to: '写真/旅行',
    count: 2,
    onMerge: () => {},
    onRename: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '420px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TagMergeDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Covers: Story = { name: '両方に概要がある', args: { from: '写真', to: 'UI', count: 22, covers: true } }
