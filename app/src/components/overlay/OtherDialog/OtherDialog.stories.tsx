import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { OtherDialog } from './OtherDialog'

const wait = () => new Promise<void>((r) => setTimeout(r, 600))

const meta = {
  title: '部品/overlay/OtherDialog',
  component: OtherDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    version: '0.1.0',
    usage: { library: 1_240_000, thumbs: 86_500_000 },
    unused: [
      { id: 'example.psd', name: 'Photoshop', version: '1.2.0', bytes: 2_310_000 },
      { id: 'example.heic', name: 'HEIC', version: '0.3.1', bytes: 845_000 },
    ],
    onClear: wait,
    onRemoveUnused: wait,
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '640px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OtherDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const NoUnused: Story = { name: '使っていないものがない', args: { unused: [] } }
export const Loading: Story = { name: '読み込み中', args: { usage: undefined, unused: undefined } }
/** 片付けられない環境（画面の見本など）では、版だけを出す。 */
export const VersionOnly: Story = { name: '版だけ', args: { onClear: undefined, onRemoveUnused: undefined } }
export const Failed: Story = {
  name: '消せなかった',
  args: {
    onClear: async () => {
      await wait()
      throw new Error('library: 別のプロセスが使用中です')
    },
  },
}
