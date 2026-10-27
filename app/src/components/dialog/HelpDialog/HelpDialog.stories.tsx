import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { HelpDialog } from './HelpDialog'

const meta = {
  title: '部品/dialog/HelpDialog',
  component: HelpDialog,
  parameters: { layout: 'fullscreen' },
  args: { onClose: () => {} },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '640px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HelpDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
