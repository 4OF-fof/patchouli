import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { SectionLabel } from './SectionLabel'

const meta = {
  title: '部品/基本/SectionLabel',
  component: SectionLabel,
  args: { label: '今週', count: 14 },
} satisfies Meta<typeof SectionLabel>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const NoCount: Story = { args: { label: '静かなもの', count: undefined } }
export const Clickable: Story = { args: { label: '秋の企画', count: 32, onClick: () => {} } }
