import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ImageZoom } from './ImageZoom'

/** 中身は動作確認用のライブラリ（scripts/dev-library.ts が作る）のもの。なければ表示できない。 */
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
/** 枠より小さい画像は、「全体」でも引き伸ばさない。 */
export const Small: Story = { name: '小さい画像', args: { src: '/favicon.svg', name: 'favicon' } }
