import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { findItems } from '../../../model/search'
import { sampleLibrary } from '../../../samples/library'
import { type Row, SearchResults } from './SearchResults'

const lib = sampleLibrary()

const meta = {
  title: '部品/nav/SearchResults',
  component: SearchResults,
  args: { lib, rows: [], selected: 0, terms: [], onRun: () => {} },
  decorators: [
    (Story) => (
      <div role="listbox" style={{ width: '600px', padding: '6px', background: 'var(--float)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchResults>
export default meta
type Story = StoryObj<typeof meta>

const recent: Row[] = [
  ...lib.projects.slice(0, 2).map((p): Row => ({ type: 'proj', p })),
  ...lib.items
    .toSorted((a, b) => a.moved - b.moved)
    .slice(0, 5)
    .map((it): Row => ({ type: 'item', it, where: `最近 · ${it.folder ?? 'プロジェクトなし'}` })),
]

const typed: Row[] = [
  { type: 'cmd', label: '新しいノートを作成', key: 'Ctrl N', run: () => {} },
  ...findItems(lib, ['配色'])
    .slice(0, 5)
    .map((f): Row => ({ type: 'item', ...f })),
  { type: 'create', q: '配色' },
]

export const Recent: Story = { name: '開いたところ', args: { rows: recent } }
export const Typed: Story = { name: '入力中', args: { rows: typed, terms: ['配色'] } }
export const NoMatch: Story = { name: '一致なし', args: { rows: [], terms: ['存在しない語'] } }
