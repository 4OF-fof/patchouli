import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from '../../components/overlay/DropZone/DropZone'
import { Toast } from '../../components/overlay/Toast/Toast'
import { buildLibrary } from '../../model/library'
import { PINNED_PROJECTS, PINNED_TAGS, TODAY, sampleLibrary } from '../../samples/library'
import { AppDock, type DockState } from '../AppDock'
import { ScreenFrame } from '../ScreenFrame'
import { EditionScreen } from './EditionScreen'

const meta = {
  title: '画面/00 ホーム',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

/** ホームに検索バーを重ねた、アプリを開いたときの見た目。 */
const edition = (
  o: { dock?: DockState; query?: string; scrollTop?: number; readOnly?: boolean; pinsOpen?: boolean } = {},
) => {
  const lib = sampleLibrary()
  return (
    <>
      <EditionScreen
        lib={lib}
        pinnedProjects={PINNED_PROJECTS}
        pinnedTags={PINNED_TAGS}
        pinsOpen={o.pinsOpen}
        scrollTop={o.scrollTop}
      />
      <AppDock lib={lib} here="home" initial={o.dock} query={o.query} readOnly={o.readOnly} />
    </>
  )
}

export const Default: Story = { render: () => <ScreenFrame>{edition()}</ScreenFrame> }
export const PinsOpen: Story = {
  name: 'ピン留めを全件表示',
  render: () => <ScreenFrame>{edition({ pinsOpen: true })}</ScreenFrame>,
}
export const Scrolled: Story = {
  name: 'スクロール後',
  render: () => <ScreenFrame>{edition({ scrollTop: 1100 })}</ScreenFrame>,
}
export const Search: Story = {
  name: '検索を開く',
  render: () => <ScreenFrame>{edition({ dock: 'search' })}</ScreenFrame>,
}
export const Typing: Story = {
  name: '検索に入力中',
  render: () => <ScreenFrame>{edition({ dock: 'search', query: '配色' })}</ScreenFrame>,
}
export const Prompt: Story = {
  name: 'プロンプト',
  render: () => <ScreenFrame>{edition({ dock: 'prompt' })}</ScreenFrame>,
}
export const Menu: Story = {
  name: 'メニューを開く',
  render: () => <ScreenFrame>{edition({ dock: 'menu' })}</ScreenFrame>,
}
export const Settings: Story = {
  name: 'メニュー · 設定',
  render: () => <ScreenFrame>{edition({ dock: 'settings' })}</ScreenFrame>,
}
export const Help: Story = {
  name: 'キー操作の一覧',
  render: () => <ScreenFrame>{edition({ dock: 'help' })}</ScreenFrame>,
}
export const Drop: Story = {
  name: '08 ファイルを持ってきた',
  render: () => (
    <ScreenFrame>
      {edition()}
      <DropZone title="12 件のファイルを取り込む" sub="ドロップしてプロジェクト未指定で取り込みます" />
    </ScreenFrame>
  ),
}
export const ReadOnly: Story = {
  name: '08 書き込めない保存先',
  render: () => <ScreenFrame>{edition({ readOnly: true })}</ScreenFrame>,
}
export const Empty: Story = {
  name: '08 まだ何もない',
  render: () => {
    const lib = buildLibrary([], [], TODAY)
    return (
      <ScreenFrame>
        <EditionScreen lib={lib} location="D:\Library\Example" />
        <AppDock lib={lib} here="home" />
      </ScreenFrame>
    )
  },
}
export const LoadError: Story = {
  name: '08 一部を読み込めない',
  render: () => (
    <ScreenFrame
      toast={
        <Toast message="3 件のノートを読み込めませんでした" actionLabel="見る" onAction={() => {}} onClose={() => {}} />
      }
    >
      {edition()}
    </ScreenFrame>
  ),
}
