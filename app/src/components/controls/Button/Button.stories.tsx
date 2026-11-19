import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Button } from './Button'

const meta = { title: '部品/controls/Button', component: Button, args: { children: '編集' } } satisfies Meta<
  typeof Button
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Primary: Story = { args: { variant: 'primary', children: '承認' } }
export const PrimaryDisabled: Story = {
  args: { variant: 'primary', disabled: true, children: '承認' },
}
export const Ghost: Story = { args: { variant: 'ghost', children: '‹ ホーム' } }
export const Danger: Story = { args: { variant: 'danger', children: 'アンインストール' } }
export const Pressed: Story = { args: { pressed: true } }
export const Small: Story = { args: { size: 'sm' } }
