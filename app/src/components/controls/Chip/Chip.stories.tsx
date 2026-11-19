import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Chip } from './Chip'

const meta = {
  title: '部品/controls/Chip',
  component: Chip,
  args: { children: '# 写真/旅行' },
} satisfies Meta<typeof Chip>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Add: Story = { args: { dashed: true, children: '＋ タグ' } }
