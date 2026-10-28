import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { NumberField } from './NumberField'

const meta = {
  title: '部品/controls/NumberField',
  component: NumberField,
  args: { value: 24, min: 0, max: 100, 'aria-label': '件数' },
} satisfies Meta<typeof NumberField>
export default meta
type Story = StoryObj<typeof meta>

const live = (args: Story['args']) => {
  const [value, setValue] = createSignal(args?.value ?? 0)
  return <NumberField {...args} value={value()} onChange={setValue} />
}

export const Default: Story = { render: live }
export const AtMin: Story = { name: '最小値', args: { value: 0 }, render: live }
export const Step: Story = { name: '0.5 刻み', args: { value: 1.5, step: 0.5, max: 5 }, render: live }
export const Disabled: Story = { name: '無効', args: { disabled: true } }
