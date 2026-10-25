import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PINNED_PROJECTS, sampleLibrary } from '../../samples/library'
import { AppDock } from '../AppDock'
import { ScreenFrame } from '../ScreenFrame'
import { ProjectListScreen } from './ProjectListScreen'

const meta = {
  title: '画面/11 プロジェクト一覧',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const list = (creating = false) => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame>
      <ProjectListScreen lib={lib} pinned={PINNED_PROJECTS} creating={creating} />
      <AppDock lib={lib} here="projects" />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => list() }
export const Create: Story = { name: '新しいプロジェクト', render: () => list(true) }
