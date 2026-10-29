import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DeleteDialog } from './DeleteDialog'

const meta = {
  title: '部品/dialog/DeleteDialog',
  component: DeleteDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    items: [{ name: 'moodboard-01' }],
    onDelete: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '360px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeleteDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Note: Story = { name: 'ノート', args: { items: [{ name: '配色メモ：秋の企画', note: true }] } }
export const Many: Story = {
  name: '複数',
  args: {
    items: [
      { name: 'moodboard-01' },
      { name: 'IMG_2041' },
      { name: '配色メモ：秋の企画', note: true },
      { name: 'leaf-macro' },
      { name: 'sage-swatch' },
      { name: 'vermilion-dot' },
      { name: 'poster-draft' },
    ],
  },
}
