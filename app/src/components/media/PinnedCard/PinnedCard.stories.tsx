import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { PinnedCard } from './PinnedCard'

const meta = {
  title: '部品/素材/PinnedCard',
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

/** ホームの並び（5 枚） */
export const Row: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: '1200px' }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div style={{ display: 'flex', gap: '12px' }}>
      <PinnedCard
        name="秋の企画"
        meta="プロジェクト · 32 件"
        tiles={[{ hue: 30 }, { hue: 15 }, { hue: 45 }, { hue: 200 }, { hue: 0 }]}
      />
      <PinnedCard
        name="日記"
        meta="プロジェクト · 64 件"
        tiles={[{ hue: 120 }, { hue: 90 }, { hue: 140 }, { hue: 60 }, { hue: 100 }]}
      />
      <PinnedCard
        name="# 写真"
        meta="タグ · 120 件"
        tiles={[{ hue: 205 }, { hue: 180 }, { hue: 220 }, { hue: 160 }, { hue: 240 }]}
      />
      <PinnedCard
        name="# UI"
        meta="タグ · 18 件"
        tiles={[{ hue: 260 }, { hue: 280 }, { hue: 240 }, { hue: 300 }, { hue: 220 }]}
      />
      <PinnedCard
        name="# 参考"
        meta="タグ · 41 件"
        tiles={[{ hue: 340 }, { hue: 10 }, { hue: 320 }, { hue: 0 }, { hue: 350 }]}
      />
    </div>
  ),
}
