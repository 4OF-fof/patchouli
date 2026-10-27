import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { AudioPlayer } from './AudioPlayer'

/** 大きくなったり小さくなったりする音を、4000 点拾った波形。 */
const wave = new Uint8Array(
  Int8Array.from(
    { length: 4000 },
    (_, i) => 127 * (0.15 + 0.85 * Math.abs(Math.sin((Math.PI * i) / 650))) * Math.sin(i * 2.3),
  ).buffer,
)

/** 中身は動作確認用のライブラリ（scripts/dev-library.ts が作る）のもの。なければ再生できない。 */
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
