import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PinToggle } from './PinToggle'

const meta = {
  title: '部品/controls/PinToggle',
  component: PinToggle,
  args: { onClick: () => {} },
} satisfies Meta<typeof PinToggle>
export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = {}
export const On: Story = { args: { pressed: true } }
export const Float: Story = { args: { look: 'float', pressed: true } }
export const Reveal: Story = {
  name: 'ホバーで出す（留めていると出たまま）',
  args: { look: 'float', reveal: true, pressed: true },
}
