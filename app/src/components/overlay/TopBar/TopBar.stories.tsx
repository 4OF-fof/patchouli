import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TopBar } from './TopBar'

const meta = {
  title: '部品/overlay/TopBar',
  component: TopBar,
  args: { children: <b>IMG_2041</b> },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TopBar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
