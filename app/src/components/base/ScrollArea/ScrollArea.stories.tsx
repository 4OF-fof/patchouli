import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import { ScrollArea } from './ScrollArea'

const rows = Array.from({ length: 60 }, (_, i) => `行 ${i + 1}`)

const meta = {
  title: '部品/base/ScrollArea',
  component: ScrollArea,
  args: {
    style: { padding: '12px 16px' },
    children: <For each={rows}>{(r) => <p style={{ margin: '0 0 8px' }}>{r}</p>}</For>,
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', height: '320px', width: '360px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScrollArea>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Short: Story = { name: 'スクロールしない', args: { children: <p>短い中身</p> } }
export const Horizontal: Story = {
  name: '横',
  args: {
    axis: 'x',
    children: (
      <div style={{ display: 'flex', gap: '8px', width: 'max-content' }}>
        <For each={rows}>
          {(r) => (
            <div style={{ width: '80px', height: '60px', background: 'var(--card)', 'border-radius': '6px' }}>{r}</div>
          )}
        </For>
      </div>
    ),
  },
}
