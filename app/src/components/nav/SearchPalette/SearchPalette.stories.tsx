import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { ResultHeading, ResultRow } from '../ResultRow/ResultRow'
import { type SearchMode, SearchPalette } from './SearchPalette'

const recent = () => (
  <>
    <ResultHeading>最近開いた項目</ResultHeading>
    <ResultRow kind="note" title="配色のメモ" sub="秋の企画" selected />
    <ResultRow kind="asset" title="夕方の港" sub="秋の企画" thumb={{ hue: 205 }} />
    <ResultRow kind="asset" title="路地の看板" sub="日記" thumb={{ hue: 20 }} />
  </>
)

const typed = () => (
  <>
    <ResultHeading>項目</ResultHeading>
    <ResultRow
      kind="note"
      title={
        <>
          <mark>配色</mark>のメモ
        </>
      }
      sub="秋の企画"
      selected
    />
    <ResultRow kind="create" title="「配色」というノートを作成" />
  </>
)

const meta = {
  title: '部品/nav/SearchPalette',
  component: SearchPalette,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          height: '100vh',
          'min-height': '560px',
          overflow: 'hidden',
          background: 'var(--paper)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchPalette>
export default meta
type Story = StoryObj<typeof meta>

export const Recent: Story = { name: '開いたところ', render: (args) => <SearchPalette {...args} results={recent()} /> }
export const Typed: Story = {
  name: '入力中',
  render: (args) => <SearchPalette {...args} query="配色" results={typed()} />,
}
const tags = () => (
  <>
    <ResultHeading>タグ</ResultHeading>
    <ResultRow
      kind="tag"
      title={
        <>
          <mark>配</mark>色
        </>
      }
      sub="12 件"
      selected
    />
    <ResultHeading>項目</ResultHeading>
    <ResultRow kind="asset" title="moodboard-01" sub="秋の企画" thumb={{ hue: 35 }} />
  </>
)

export const Filtering: Story = {
  name: '絞り込み',
  render: (args) => (
    <SearchPalette
      {...args}
      chips={['@ 秋の企画']}
      query="#配"
      hints={[
        ['Enter / Tab', '絞り込む'],
        ['Ctrl Enter', 'ページを開く'],
        ['Esc', '閉じる'],
      ]}
      results={tags()}
    />
  ),
}
export const Command: Story = { name: '操作', args: { mode: 'command' } }
export const Prompt: Story = { args: { mode: 'prompt' } }

export const Interactive: Story = {
  render: () => {
    const [mode, setMode] = createSignal<SearchMode>('search')
    const [query, setQuery] = createSignal('')
    return (
      <SearchPalette
        mode={mode()}
        query={query()}
        results={mode() === 'prompt' ? undefined : query() ? typed() : recent()}
        onQueryInput={(q) => {
          if (mode() === 'search' && q.startsWith('?')) {
            setMode('prompt')
            setQuery(q.slice(1))
          } else setQuery(q)
        }}
        onInputKeyDown={(e) => {
          if (e.key === 'Backspace' && !query()) setMode('search')
        }}
      />
    )
  },
}
