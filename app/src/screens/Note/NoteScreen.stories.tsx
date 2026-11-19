import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { sampleLibrary } from '../../samples/library'
import { ScreenFrame } from '../ScreenFrame'
import { NoteScreen, type NoteScreenProps } from './NoteScreen'

const meta = {
  title: '画面/01 ノート',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const note = (o: Partial<NoteScreenProps> = {}, name = '配色メモ：秋の企画') => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame>
      <NoteScreen lib={lib} noteId={lib.byName.get(name)?.id ?? ''} {...o} />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => note() }
export const Links: Story = { name: 'リンクを開く', render: () => note({ linksOpen: true }) }
export const HeadsClosed: Story = { name: '見出しを閉じた', render: () => note({ headsOpen: false }) }
export const Idle: Story = { name: '何も触っていない', render: () => note({ idle: true }) }
export const Props: Story = { name: 'タグなどの欄を開く', render: () => note({ propsOpen: true }) }
export const Diary: Story = { name: '日記', render: () => note({ headsOpen: false }, '2026-10-22') }
export const Showcase: Story = { name: '記法の見本', render: () => note({ headsOpen: false }, '記法の見本') }
