import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { FloatingPill } from './FloatingPill'

const meta = {
  title: '部品/controls/FloatingPill',
  component: FloatingPill,
  args: { children: '‹ ホーム' },
} satisfies Meta<typeof FloatingPill>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithKey: Story = { args: { children: 'ⓘ 情報', kbd: 'I' } }
export const WithCount: Story = { args: { children: '≡ 見出し', count: 4 } }
