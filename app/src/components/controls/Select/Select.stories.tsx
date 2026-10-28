import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Select } from './Select'

const OPTIONS = [
  { value: '', label: 'プロジェクトなし' },
  { value: '秋の企画', label: '秋の企画' },
  { value: 'UI 改善', label: 'UI 改善' },
  { value: '旅行 2026', label: '旅行 2026' },
  { value: '資料', label: '資料' },
]

const meta = {
  title: '部品/controls/Select',
  component: Select,
  args: { value: '秋の企画', options: OPTIONS, 'aria-label': 'プロジェクト' },
  decorators: [
    (Story) => (
      <div style={{ width: '240px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => {
    const [value, setValue] = createSignal(args.value)
    return <Select {...args} value={value()} onChange={setValue} />
  },
}
export const Disabled: Story = { args: { disabled: true } }
