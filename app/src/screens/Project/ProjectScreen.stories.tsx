import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from '../../components/overlay/DropZone/DropZone'
import { withEmptyProject } from '../../model/library'
import { sampleLibrary } from '../../samples/library'
import { AppBar } from '../AppBar'
import { ScreenFrame } from '../ScreenFrame'
import type { JSX } from 'solid-js'
import type { Library } from '../../model/library'
import { ProjectScreen, type ProjectScreenProps } from './ProjectScreen'

const meta = {
  title: '画面/10 プロジェクト',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const frame = (lib: Library, name: string, screen: JSX.Element, extra?: JSX.Element) => (
  <ScreenFrame bar={<AppBar lib={lib} crumbs={['ホーム', name]} />}>
    {screen}
    {extra}
  </ScreenFrame>
)
const project = (o: Partial<ProjectScreenProps> = {}, name = '秋の企画', extra?: JSX.Element) => {
  const lib = sampleLibrary()
  return frame(lib, name, <ProjectScreen lib={lib} name={name} {...o} />, extra)
}

export const Default: Story = { render: () => project() }
export const Edit: Story = { name: '概要を編集', render: () => project({ editing: true }) }
export const AddPart: Story = {
  name: '概要にセクションを追加',
  render: () => project({ editing: true, addOpen: true }),
}
export const Drop: Story = {
  name: 'ファイルを持ってきた',
  render: () =>
    project({}, '秋の企画', <DropZone title="3 件のファイルを取り込む" sub="ドロップして「秋の企画」に追加します" />),
}
export const Other: Story = {
  name: '別のプロジェクト',
  render: () => project({}, 'UI 改善'),
}
export const NoPins: Story = { name: 'ピン留めなし', render: () => project({}, '資料') }
export const NoCover: Story = { name: '表紙なし', render: () => project({}, '日記') }
export const Created: Story = {
  name: '新しく作った',
  render: () => {
    const { lib, name } = withEmptyProject(sampleLibrary())
    return frame(lib, name, <ProjectScreen lib={lib} name={name} editing />)
  },
}
