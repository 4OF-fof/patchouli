import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DateField } from './DateField'

const meta = {
  title: '部品/controls/DateField',
  component: DateField,
  args: { value: '2026-11-05', today: new Date(2026, 9, 28), 'aria-label': '期日' },
} satisfies Meta<typeof DateField>
export default meta
type Story = StoryObj<typeof meta>

const live = (args: Story['args']) => {
  const [value, setValue] = createSignal(args?.value ?? '')
  return <DateField {...args} value={value()} onChange={setValue} />
}

export const Default: Story = { render: live }
export const Empty: Story = { name: '未設定', args: { value: '', placeholder: '期日なし' }, render: live }
export const Disabled: Story = { name: '無効', args: { disabled: true } }
