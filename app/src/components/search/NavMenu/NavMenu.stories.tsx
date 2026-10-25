import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { NavMenu } from './NavMenu'
import { MAIN_ITEMS, SETTINGS_ITEMS } from './NavMenu.samples'

const meta = {
  title: '部品/search/NavMenu',
  component: NavMenu,
  args: { items: MAIN_ITEMS, onSelect: () => {} },
} satisfies Meta<typeof NavMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Main: Story = {}
export const OnTagList: Story = {
  args: {
    items: MAIN_ITEMS.map((it) => (it === 'separator' ? it : { ...it, current: it.id === 'tags' })),
  },
}
export const Settings: Story = { args: { items: SETTINGS_ITEMS } }
