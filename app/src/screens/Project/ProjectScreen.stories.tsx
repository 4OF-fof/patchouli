import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from '../../components/DropZone/DropZone'
import { withEmptyProject } from '../../model/library'
import { sampleLibrary } from '../../samples/library'
import { AppDock } from '../AppDock'
import { ScreenFrame } from '../ScreenFrame'
import { ProjectScreen, type ProjectScreenProps } from './ProjectScreen'

const meta = {
  title: '画面/10 プロジェクト',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const project = (o: Partial<ProjectScreenProps> = {}, name = '秋の企画') => {
  const lib = sampleLibrary()
  return (
    <>
      <ProjectScreen lib={lib} name={name} {...o} />
      <AppDock lib={lib} />
    </>
  )
}

export const Default: Story = { render: () => <ScreenFrame>{project()}</ScreenFrame> }
export const Edit: Story = { name: '表紙を編集', render: () => <ScreenFrame>{project({ editing: true })}</ScreenFrame> }
export const AddPart: Story = {
  name: '表紙に部品を足す',
  render: () => <ScreenFrame>{project({ editing: true, addOpen: true })}</ScreenFrame>,
}
export const Drop: Story = {
  name: 'ファイルを持ってきた',
  render: () => (
    <ScreenFrame>
      {project()}
      <DropZone title="3 個を取り込む" sub="離すと「秋の企画」に入ります" />
    </ScreenFrame>
  ),
}
export const Other: Story = {
  name: '別のプロジェクト',
  render: () => <ScreenFrame>{project({}, 'UI 改善')}</ScreenFrame>,
}
export const NoPins: Story = { name: 'ピン留めなし', render: () => <ScreenFrame>{project({}, '資料')}</ScreenFrame> }
export const NoCover: Story = { name: '表紙なし', render: () => <ScreenFrame>{project({}, '日記')}</ScreenFrame> }
export const Created: Story = {
  name: '新しく作った',
  render: () => {
    const { lib, name } = withEmptyProject(sampleLibrary())
    return (
      <ScreenFrame>
        <ProjectScreen lib={lib} name={name} editing />
        <AppDock lib={lib} />
      </ScreenFrame>
    )
  },
}
