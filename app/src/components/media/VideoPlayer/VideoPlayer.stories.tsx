import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { VideoPlayer } from './VideoPlayer'

const meta = {
  title: '部品/media/VideoPlayer',
  component: VideoPlayer,
  args: { src: '/dev-library/clip-0412.mp4', name: 'clip-0412' },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', width: '760px', height: '480px', padding: '16px', background: 'var(--stage)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VideoPlayer>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
