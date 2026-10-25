import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { LinkCaption, LinkNone, LinkRow } from './LinkRow'

const meta = {
  title: '部品/overlay/LinkRow',
  component: LinkRow,
  args: { mark: '→', label: 'moodboard-01', sub: '素材', onClick: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: '280px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LinkRow>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Missing: Story = { args: { label: '差し色の比較', sub: '未作成', missing: true } }
export const Current: Story = { args: { mark: undefined, label: '紙の質感', sub: undefined, current: true } }
export const Group: Story = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
      <LinkCaption>このノートへ</LinkCaption>
      <LinkRow mark="←" label="秋の企画：進め方" sub="ノート" />
      <LinkCaption>このノートから</LinkCaption>
      <LinkRow mark="→" label="moodboard-01" sub="素材" />
      <LinkRow mark="→" label="差し色の比較" sub="未作成" missing />
      <LinkCaption>この素材を使っているノート</LinkCaption>
      <LinkNone>まだありません</LinkNone>
    </div>
  ),
}
