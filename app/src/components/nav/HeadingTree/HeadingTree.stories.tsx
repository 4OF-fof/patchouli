import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { HeadingTree } from './HeadingTree'

const meta = {
  title: '部品/nav/HeadingTree',
  component: HeadingTree,
  args: {
    title: '配色メモ：秋の企画',
    headings: [
      { level: 2, text: '紙の質感' },
      { level: 3, text: '候補' },
      { level: 4, text: '写真' },
      { level: 3, text: '色温度' },
      { level: 2, text: '差し色' },
      { level: 3, text: '比較' },
    ],
    current: 3,
    onSelect: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '260px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeadingTree>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Top: Story = { args: { current: -1 } }
