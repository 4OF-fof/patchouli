import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ItemCard } from './ItemCard'

const meta = {
  title: '部品/media/ItemCard',
  component: ItemCard,
  args: { name: '夕方の港', hue: 205, height: 160, onClick: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: '240px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ItemCard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithWhy: Story = { args: { why: 'つながり 3 · 2 日前' } }
export const Note: Story = {
  args: {
    note: true,
    name: '配色のメモ',
    excerpt: '彩度を落とした青を基調に、差し色を一点だけ使う。',
    why: '編集 · 今日',
  },
}
export const Unsaved: Story = {
  args: { note: true, name: '配色のメモ', excerpt: '彩度を落とした青を基調に。', dirty: true },
}
export const NameHidden: Story = { args: { showName: false } }
export const Pin: Story = { name: 'ピンを重ねる', args: { onPin: () => {} } }
export const Pinned: Story = { name: 'ピン留めしている', args: { pinned: true, onPin: () => {} } }
