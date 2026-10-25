import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { Tabs } from './Tabs'

const meta = {
  title: '部品/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>
export default meta
type Story = StoryObj<typeof meta>

export const Sort: Story = {
  args: { label: '並べ方', value: 'moved', items: [] },
  render: () => {
    const [v, setV] = createSignal('moved')
    return (
      <Tabs
        label="並べ方"
        value={v()}
        onChange={setV}
        items={[
          { key: 'moved', label: '動いた順' },
          { key: 'name', label: '名前順' },
          { key: 'kind', label: '種類' },
        ]}
      />
    )
  },
}
