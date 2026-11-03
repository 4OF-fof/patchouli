import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Toast } from './Toast'

const meta = {
  title: '部品/overlay/Toast',
  component: Toast,
  args: { message: '外で変更されたので読み込み直しました' },
  argTypes: { level: { control: 'inline-radio', options: ['info', 'success', 'warning', 'error'] } },
} satisfies Meta<typeof Toast>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Success: Story = {
  args: { level: 'success', message: '「配色のメモ」を作りました', onClose: () => {} },
}
export const WithAction: Story = {
  args: { level: 'success', message: '3 件の素材にタグを付けました', actionLabel: '元に戻す', onAction: () => {} },
}
export const LoadError: Story = {
  args: {
    level: 'error',
    message: '3 件のノートを読み込めませんでした',
    actionLabel: '見る',
    onAction: () => {},
    onClose: () => {},
  },
}
export const MissingLink: Story = {
  args: {
    level: 'warning',
    message: '「配色メモ」に、見つからないリンクが 2 件あります',
    actionLabel: '修正',
    onAction: () => {},
    onClose: () => {},
    closeLabel: '無視',
  },
}
export const Levels: Story = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start', gap: '12px' }}>
      <Toast message="外で変更されたので読み込み直しました" onClose={() => {}} />
      <Toast level="success" message="「配色のメモ」をごみ箱に移動しました" onClose={() => {}} />
      <Toast
        level="warning"
        message="「配色メモ」に、見つからないリンクが 2 件あります"
        actionLabel="修正"
        onClose={() => {}}
        closeLabel="無視"
      />
      <Toast level="error" message="保存できませんでした：ファイルが使われています" onClose={() => {}} />
    </div>
  ),
}
