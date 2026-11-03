import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Peek } from './Peek'

const meta = {
  title: '部品/overlay/Peek',
  component: Peek,
  args: {
    label: '配色メモ',
    onExpand: () => {},
    onClose: () => {},
    children: <div style={{ padding: '28px' }}>リンク先の中身</div>,
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '560px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Peek>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
