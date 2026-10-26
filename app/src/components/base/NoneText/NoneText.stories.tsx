import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { NoneText } from './NoneText'

const meta = {
  title: '部品/base/NoneText',
  component: NoneText,
  args: { children: '説明はまだありません' },
} satisfies Meta<typeof NoneText>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
