import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ResultHeading, ResultRow } from './ResultRow'

const meta = {
  title: '部品/ResultRow',
  component: ResultRow,
  args: { kind: 'command', title: '整理を開く', kbd: 'Ctrl U' },
  decorators: [
    (Story) => (
      <div style={{ width: '620px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResultRow>
export default meta
type Story = StoryObj<typeof meta>

export const Command: Story = {}
export const Project: Story = {
  args: { kind: 'project', title: '秋の企画', sub: '32 件 · 最後に扱った 2 日前', kbd: undefined },
}
export const Note: Story = {
  args: { kind: 'note', sub: '最近 · 秋の企画', kbd: undefined },
  render: (args) => (
    <ResultRow
      {...args}
      title={
        <>
          <mark>配色</mark>のメモ
        </>
      }
    />
  ),
}
export const Asset: Story = {
  args: { kind: 'asset', title: '夕方の港', thumb: { hue: 205 }, kbd: undefined },
  render: (args) => (
    <ResultRow
      {...args}
      sub={
        <>
          タグ # <mark>写真</mark>/旅行
        </>
      }
    />
  ),
}
export const Create: Story = {
  args: { kind: 'create', title: '「配色」という名前でノートを作る', kbd: undefined },
}
export const Selected: Story = {
  args: {
    kind: 'note',
    title: '配色のメモ',
    sub: '最近 · 秋の企画',
    selected: true,
    kbd: undefined,
  },
}

/** 結果の並び */
export const List: Story = {
  render: () => (
    <div role="listbox">
      <ResultHeading>操作</ResultHeading>
      <ResultRow
        kind="command"
        title={
          <>
            <mark>配色</mark>を整える
          </>
        }
        kbd="Ctrl U"
      />
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
      <ResultRow
        kind="asset"
        title="港の看板"
        sub={
          <>
            本文 …<mark>配色</mark>の参考に…
          </>
        }
        thumb={{ hue: 20 }}
      />
      <ResultRow kind="create" title="「配色」という名前でノートを作る" />
    </div>
  ),
}
