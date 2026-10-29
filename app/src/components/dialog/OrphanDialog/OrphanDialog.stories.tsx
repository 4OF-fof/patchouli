import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { OrphanDialog } from './OrphanDialog'

const meta = {
  title: '部品/dialog/OrphanDialog',
  component: OrphanDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    orphans: [
      {
        meta: 'C:/lib/秋の企画/IMG_2041.jpg.meta',
        name: 'IMG_2041.jpg',
        folder: '秋の企画',
        project: false,
        candidates: ['IMG_2041 (2).jpg', 'leaf.jpg'],
      },
      { meta: 'C:/lib/旅行 2026.meta', name: '旅行 2026', folder: null, project: true, candidates: ['旅行 2026 春'] },
      { meta: 'C:/lib/capture.png.meta', name: 'capture.png', folder: null, project: false, candidates: [] },
    ],
    onRelink: () => {},
    onDiscard: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '480px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrphanDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
