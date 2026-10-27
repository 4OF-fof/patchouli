import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PINNED_PROJECTS, sampleLibrary } from '../../samples/library'
import { AppBar } from '../AppBar'
import { ScreenFrame } from '../ScreenFrame'
import { ProjectListScreen } from './ProjectListScreen'

const meta = {
  title: '画面/11 プロジェクト一覧',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const list = () => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame bar={<AppBar lib={lib} here="projects" crumbs={['プロジェクト一覧']} />}>
      <ProjectListScreen lib={lib} pinned={PINNED_PROJECTS} />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => list() }
