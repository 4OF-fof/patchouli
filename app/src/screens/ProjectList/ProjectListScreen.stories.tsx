import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { buildLibrary } from '../../model/library'
import { PINNED_PROJECTS, TODAY, sampleLibrary } from '../../samples/library'
import { AppBar } from '../AppBar'
import { ScreenFrame } from '../ScreenFrame'
import { ProjectListScreen } from './ProjectListScreen'

const meta = {
  title: '画面/11 プロジェクト一覧',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const list = (lib = sampleLibrary(), pinned = PINNED_PROJECTS) => {
  return (
    <ScreenFrame bar={<AppBar lib={lib} here="projects" crumbs={['プロジェクト一覧']} />}>
      <ProjectListScreen lib={lib} pinned={pinned} />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => list() }
export const NoPins: Story = { name: 'ピン留めなし', render: () => list(sampleLibrary(), []) }
export const Empty: Story = { name: 'プロジェクトがない', render: () => list(buildLibrary([], [], TODAY), []) }
