import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from './DropZone'

const meta = {
  title: '部品/浮かぶもの/DropZone',
  component: DropZone,
  parameters: { layout: 'fullscreen' },
  args: { title: '12 個を取り込む', sub: '離すと取り込み、自動分類の確認に回ります' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '480px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DropZone>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const IntoProject: Story = { args: { title: '3 個を取り込む', sub: '離すと「秋の企画」に入ります' } }
