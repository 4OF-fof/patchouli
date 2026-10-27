import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Thumb, ThumbMakingProvider } from './Thumb'

const meta = {
  title: '部品/media/Thumb',
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
export const Note: Story = {
  args: {
    note: true,
    title: '配色のメモ',
    excerpt: '彩度を落とした青を基調に、差し色を一点だけ使う。',
  },
}
export const Selected: Story = { args: { selected: true } }

/** サムネイルがまだなく、裏で作っているあいだ。 */
export const Making: Story = {
  name: '作成中',
  args: { id: 'a' },
  decorators: [
    (Story) => (
      <ThumbMakingProvider value={() => true}>
        <Story />
      </ThumbMakingProvider>
    ),
  ],
}
