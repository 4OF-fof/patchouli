import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { KnownLibrary } from '../../../backend/types'
import { LibrariesDialog } from './LibrariesDialog'

const today = new Date('2026-10-22T15:00')
const at = (s: string) => new Date(s).getTime()

const libraries: KnownLibrary[] = [
  {
    path: 'D:\\Library\\素材',
    name: '素材',
    opened: at('2026-10-22T09:40'),
    exists: true,
    current: true,
  },
  {
    path: 'C:\\Users\\fof\\Documents\\仕事',
    name: '仕事',
    opened: at('2026-10-21T18:00'),
    exists: true,
    current: false,
  },
  {
    path: 'E:\\Backup\\2025',
    name: '2025',
    opened: at('2026-08-03T12:00'),
    exists: false,
    current: false,
  },
]

const wait = () => new Promise<void>((r) => setTimeout(r, 600))

const meta = {
  title: '部品/overlay/LibrariesDialog',
  component: LibrariesDialog,
  parameters: { layout: 'fullscreen' },
  args: { libraries, today, onOpen: wait, onForget: wait, onChoose: wait, onClose: () => {} },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '640px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LibrariesDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { name: 'まだない', args: { libraries: [] } }
export const Loading: Story = { name: '読み込み中', args: { libraries: undefined } }
export const Failed: Story = {
  name: '切り替えられなかった',
  args: {
    onOpen: async () => {
      await wait()
      throw new Error('C:\\Users\\fof\\Documents\\仕事 が見つからない')
    },
  },
}
