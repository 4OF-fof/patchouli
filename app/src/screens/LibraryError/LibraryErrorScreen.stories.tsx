import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { LibraryActions } from '../../backend/types'
import { LibraryErrorScreen } from './LibraryErrorScreen'

const meta = {
  title: '画面/ライブラリを開けない',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const libraries: LibraryActions = {
  list: async () => [
    { path: 'D:\\Library\\素材', name: '素材', opened: Date.now(), exists: true, current: true },
    {
      path: 'C:\\Users\\fof\\Documents\\仕事',
      name: '仕事',
      opened: Date.now() - 86400000,
      exists: true,
      current: false,
    },
  ],
  switch: async () => {},
  forget: async () => {},
}

export const Locked: Story = {
  name: '別のウィンドウで開いている',
  render: () => (
    <LibraryErrorScreen
      reason="このライブラリ（D:\Library\素材）は別のウィンドウで開いています"
      libraries={libraries}
      onChoose={async () => false}
    />
  ),
}
