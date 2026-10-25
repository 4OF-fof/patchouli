import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ProgressBar } from './ProgressBar'

const meta = {
  title: '部品/base/ProgressBar',
  component: ProgressBar,
  args: { value: 0.4 },
  decorators: [(Story) => <div style={{ width: '240px' }}>{Story()}</div>],
} satisfies Meta<typeof ProgressBar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Full: Story = { args: { value: 1 } }
