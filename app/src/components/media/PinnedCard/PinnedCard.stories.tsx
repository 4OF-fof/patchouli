import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { PinnedCard } from './PinnedCard'

const meta = {
  title: '部品/media/PinnedCard',
  component: PinnedCard,
  args: {
    name: '秋の企画',
    meta: '32 件',
    tiles: [{}, {}, {}, {}, {}],
    onClick: () => {},
  },
} satisfies Meta<typeof PinnedCard>
export default meta
type Story = StoryObj<typeof meta>

const single = (Story: () => JSX.Element) => (
  <div style={{ display: 'flex', width: '360px' }}>
    <Story />
  </div>
)

export const Project: Story = { decorators: [single] }
export const Tag: Story = {
  args: {
    name: '# 写真',
    meta: '120 件',
    tiles: [{}, {}, {}, {}, {}],
  },
  decorators: [single],
}
export const Large: Story = {
  name: '大きく出す 1 枚',
  args: { large: true },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', width: '720px', height: '420px' }}>
        <Story />
      </div>
    ),
  ],
}
