import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { ResultHeading, ResultRow } from '../ResultRow/ResultRow'
import { type SearchMode, SearchPalette } from './SearchPalette'

const recent = () => (
  <>
    <ResultHeading>プロジェクト</ResultHeading>
    <ResultRow kind="project" title="秋の企画" sub="32 件 · 最終更新 2 日前" selected />
    <ResultRow kind="project" title="日記" sub="64 件 · 最終更新 今日" />
    <ResultHeading>項目</ResultHeading>
    <ResultRow kind="note" title="配色のメモ" sub="最近 · 秋の企画" />
    <ResultRow kind="asset" title="夕方の港" sub="最近 · 秋の企画" thumb={{ hue: 205 }} />
    <ResultRow kind="asset" title="路地の看板" sub="最近 · 日記" thumb={{ hue: 20 }} />
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
        onQueryInput={setQuery}
        onInputKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            setMode(mode() === 'prompt' ? 'search' : 'prompt')
          }
        }}
      />
    )
  },
}
