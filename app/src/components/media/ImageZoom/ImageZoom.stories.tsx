import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ImageZoom } from './ImageZoom'

const meta = {
  title: '部品/media/ImageZoom',
  component: ImageZoom,
  args: { src: '/dev-library/IMG_3310.jpg', name: 'IMG_3310' },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', width: '760px', height: '480px', padding: '16px', background: 'var(--stage)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ImageZoom>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Small: Story = { name: '小さい画像', args: { src: '/favicon.svg', name: 'favicon' } }
