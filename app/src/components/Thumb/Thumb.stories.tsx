import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Thumb } from './Thumb'

const meta = {
  title: '部品/Thumb',
  component: Thumb,
  args: { hue: 210, height: 160 },
  decorators: [
    (Story) => (
      <div style={{ width: '240px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Thumb>
export default meta
type Story = StoryObj<typeof meta>

export const Image: Story = {}
export const Video: Story = { args: { kind: 'video', hue: 20 } }
export const Audio: Story = { args: { kind: 'audio', hue: 150 } }
export const Note: Story = {
  args: {
    kind: 'note',
    title: '配色のメモ',
    excerpt: '彩度を落とした青を基調に、差し色を一点だけ使う。',
  },
}
export const Selected: Story = { args: { selected: true } }
