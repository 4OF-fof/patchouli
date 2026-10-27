import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { AudioPlayer } from './AudioPlayer'

const wave = Uint8Array.from({ length: 4000 }, (_, i) => 255 * (0.15 + 0.85 * Math.abs(Math.sin((Math.PI * i) / 650))))

const meta = {
  title: '部品/media/AudioPlayer',
  component: AudioPlayer,
  args: { src: '/dev-library/voice-1019.mp3', name: 'voice-1019', wave },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', width: '760px', height: '480px', padding: '16px', background: 'var(--stage)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AudioPlayer>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const NoWave: Story = { name: '波形がまだない', args: { wave: null } }
