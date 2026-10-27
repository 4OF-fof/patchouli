import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { PinnedCard } from './PinnedCard'

const meta = {
  title: '部品/media/PinnedCard',
  component: PinnedCard,
  args: {
    name: '秋の企画',
    meta: 'プロジェクト · 32 件',
    tiles: [{ hue: 30 }, { hue: 15 }, { hue: 45 }, { hue: 200 }, { hue: 0 }],
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
    meta: 'タグ · 120 件',
    tiles: [{ hue: 205 }, { hue: 180 }, { hue: 220 }, { hue: 160 }, { hue: 240 }],
  },
  decorators: [single],
}
export const Asset: Story = {
  name: '素材を 1 つ留めた',
  args: { name: 'IMG_2041', meta: '素材 · JPEG', tiles: [], thumb: { hue: 30 } },
  decorators: [single],
}
export const Note: Story = {
  name: 'ノートを 1 つ留めた',
  args: {
    name: '配色メモ',
    meta: 'ノート',
    tiles: [],
    thumb: { note: true, title: '配色メモ', excerpt: '彩度を落とした色を基調にし、差し色に朱を使う。' },
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
