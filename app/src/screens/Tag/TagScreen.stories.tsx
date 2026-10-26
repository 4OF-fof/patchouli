import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PINNED_TAGS, sampleLibrary } from '../../samples/library'
import { AppDock } from '../AppDock'
import { ScreenFrame } from '../ScreenFrame'
import { TagScreen, type TagScreenProps } from './TagScreen'

const meta = {
  title: '画面/13 タグ',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const tag = (o: Partial<TagScreenProps> = {}, name = '写真') => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame>
      <TagScreen lib={lib} tag={name} pinned={PINNED_TAGS.includes(name)} backLabel="タグ一覧" {...o} />
      <AppDock lib={lib} />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => tag() }
export const Sub: Story = { name: 'サブタグで絞り込む', render: () => tag({ sub: '写真/旅行' }) }
export const Edit: Story = { name: '概要を編集', render: () => tag({ editing: true, addOpen: true }) }
export const NoCover: Story = { name: '概要がないタグ', render: () => tag({}, '参考') }
