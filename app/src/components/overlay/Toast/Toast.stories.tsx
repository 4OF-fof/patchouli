import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Toast } from './Toast'

const meta = {
  title: '部品/overlay/Toast',
  component: Toast,
  args: { message: '「配色のメモ」を作りました' },
} satisfies Meta<typeof Toast>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithAction: Story = {
  args: { message: '3 件の素材にタグを付けました', actionLabel: '元に戻す', onAction: () => {} },
}
export const LoadError: Story = {
  args: {
    message: '3 件のノートを読み込めませんでした',
    actionLabel: '見る',
    onAction: () => {},
    onClose: () => {},
  },
}
