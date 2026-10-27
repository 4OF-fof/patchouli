import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Spinner } from './Spinner'

const meta = {
  title: '部品/base/Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Large: Story = { name: '大きい', args: { size: 24 } }
