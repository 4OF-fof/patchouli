import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ImportDialog } from './ImportDialog'

const meta = {
  title: '部品/overlay/ImportDialog',
  component: ImportDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    files: 24,
    folders: [
      { key: 0, name: '旅の写真', files: 18, subfolders: 1 },
      { key: 1, name: 'スキャン', files: 2, subfolders: 0 },
    ],
    loose: 4,
    onImport: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '560px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ImportDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const IntoProject: Story = { name: 'プロジェクトの中で', args: { into: '秋の企画' } }
export const FoldersOnly: Story = {
  name: 'フォルダだけ',
  args: { files: 18, folders: [{ key: 0, name: '旅の写真', files: 18, subfolders: 3 }], loose: 0 },
}
export const ManyFolders: Story = {
  name: 'フォルダが多い',
  args: {
    files: 160,
    folders: Array.from({ length: 14 }, (_, i) => ({
      key: i,
      name: `2025-${String(i + 1).padStart(2, '0')} 撮影分のとても長いフォルダの名前`,
      files: 10 + i,
      subfolders: i % 3,
    })),
    loose: 1,
  },
}
