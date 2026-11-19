import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TagGoneDialog } from './TagGoneDialog'

const meta = {
  title: '部品/dialog/TagGoneDialog',
  component: TagGoneDialog,
  parameters: { layout: 'fullscreen' },
  args: { tag: 'UI', onDelete: () => {}, onClose: () => {} },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '360px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TagGoneDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
