import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import icon from '../../../../src-tauri/icons/32x32.png'
import { TitleBar } from './TitleBar'

const meta = {
  title: '部品/base/TitleBar',
  component: TitleBar,
  parameters: { layout: 'fullscreen' },
  args: { icon, onMinimize: () => {}, onToggleMaximize: () => {}, onClose: () => {} },
} satisfies Meta<typeof TitleBar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Maximized: Story = { name: '最大化中', args: { maximized: true } }
