import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { FloatingCard } from './FloatingCard'

const meta = {
  title: '部品/浮かぶもの/FloatingCard',
  component: FloatingCard,
  args: { title: '見出し' },
} satisfies Meta<typeof FloatingCard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { onClose: () => {} },
  render: (args) => (
    <FloatingCard {...args}>
      <p style={{ margin: 0 }}>本文の見出しがここに並ぶ。</p>
    </FloatingCard>
  ),
}
