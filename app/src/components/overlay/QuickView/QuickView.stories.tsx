import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { QuickView } from './QuickView'

const meta = {
  title: '部品/overlay/QuickView',
  component: QuickView,
  args: {
    id: 'i7',
    name: '配色メモ',
    kind: 'ノート',
    media: { kind: 'text', text: '背景は中立の灰にする。アクセントは鋼の青で、印は暖かい黄。' },
    left: 24,
    top: 24,
  },
} satisfies Meta<typeof QuickView>
export default meta
type Story = StoryObj<typeof meta>

export const Note: Story = {}

export const Missing: Story = { args: { name: undefined, kind: undefined, media: undefined } }
