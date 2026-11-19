import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Kbd } from './Kbd'

const meta = { title: '部品/base/Kbd', component: Kbd, args: { children: 'Ctrl P' } } satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Single: Story = { args: { children: 'I' } }
