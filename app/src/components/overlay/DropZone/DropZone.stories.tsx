import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from './DropZone'

const meta = {
  title: '部品/overlay/DropZone',
  component: DropZone,
  parameters: { layout: 'fullscreen' },
  args: { title: '12 件のファイルを取り込む', sub: 'ドロップしてプロジェクト未指定で取り込みます' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '480px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DropZone>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { title: '12 件のファイルを取り込む', sub: 'ドロップしてプロジェクト未指定で取り込みます' },
}
export const IntoProject: Story = {
  args: { title: '3 件のファイルを取り込む', sub: 'ドロップして「秋の企画」に追加します' },
}
