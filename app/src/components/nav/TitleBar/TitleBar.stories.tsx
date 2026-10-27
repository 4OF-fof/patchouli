import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import icon from '../../../../src-tauri/icons/32x32.png'
import { TitleBar } from './TitleBar'

const controls = (maximized: boolean) => ({
  icon,
  maximized: createSignal(maximized)[0],
  onMinimize: () => {},
  onToggleMaximize: () => {},
  onClose: () => {},
})

const meta = {
  title: '部品/nav/TitleBar',
  component: TitleBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TitleBar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <TitleBar window={controls(false)}>ホーム</TitleBar> }
export const Maximized: Story = { name: '最大化中', render: () => <TitleBar window={controls(true)}>ホーム</TitleBar> }
export const Web: Story = { name: 'web（窓のボタンなし）', render: () => <TitleBar>ホーム</TitleBar> }
