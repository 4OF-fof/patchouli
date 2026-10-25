import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Icon } from './Icon'

const meta = {
  title: '部品/基本/Icon',
  component: Icon,
  args: { name: 'chevron' },
  decorators: [(Story) => <div style={{ width: '32px', height: '32px' }}>{Story()}</div>],
} satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

export const Chevron: Story = {}
export const Pin: Story = { args: { name: 'pin' } }
