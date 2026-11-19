import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PluginAddDialog } from './PluginAddDialog'

const meta = {
  title: '部品/dialog/PluginAddDialog',
  component: PluginAddDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    onGithub: () => {},
    onZip: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '320px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginAddDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
