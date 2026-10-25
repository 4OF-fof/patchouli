import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PINNED_TAGS, sampleLibrary } from '../../samples/library'
import { AppDock } from '../AppDock'
import { ScreenFrame } from '../ScreenFrame'
import { TagListScreen, type TagListScreenProps } from './TagListScreen'

const meta = {
  title: '画面/12 タグ一覧',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const tags = (o: Partial<TagListScreenProps> = {}) => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame>
      <TagListScreen lib={lib} pinned={PINNED_TAGS} {...o} />
      <AppDock lib={lib} here="tags" />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => tags() }
export const Expanded: Story = { name: '下の階層を開く', render: () => tags({ expanded: ['写真', 'UI'] }) }
export const ByName: Story = { name: '五十音順', render: () => tags({ sort: 'name' }) }
