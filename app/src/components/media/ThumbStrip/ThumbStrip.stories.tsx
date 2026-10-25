import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { sampleLibrary } from '../../../samples/library'
import { ThumbStrip } from './ThumbStrip'

const items = sampleLibrary().items.slice(0, 14)

const meta = {
  title: '部品/素材/ThumbStrip',
  component: ThumbStrip,
  args: { items },
  decorators: [(Story) => <div style={{ width: '520px', '--thumb-h': '62px' }}>{Story()}</div>],
} satisfies Meta<typeof ThumbStrip>
export default meta
type Story = StoryObj<typeof meta>

export const Hide: Story = {}
export const Clip: Story = { args: { overflow: 'clip', onOpen: () => {} } }
