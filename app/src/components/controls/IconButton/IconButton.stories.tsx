import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from './IconButton'

const meta = {
  title: '部品/controls/IconButton',
  component: IconButton,
  args: { label: 'すべて見る', children: <Icon name="chevron" /> },
} satisfies Meta<typeof IconButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Pressed: Story = { args: { 'aria-pressed': true } }
export const Float: Story = { args: { look: 'float' } }
