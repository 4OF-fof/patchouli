import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Checkbox } from './Checkbox'

const meta = {
  title: '部品/controls/Checkbox',
  component: Checkbox,
  args: { 'aria-label': '完了' },
} satisfies Meta<typeof Checkbox>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => {
    const [on, setOn] = createSignal(false)
    return <Checkbox {...args} checked={on()} onChange={(e) => setOn(e.currentTarget.checked)} />
  },
}
export const Checked: Story = { name: 'オン', args: { checked: true } }
export const Disabled: Story = { name: '無効', args: { checked: true, disabled: true } }
