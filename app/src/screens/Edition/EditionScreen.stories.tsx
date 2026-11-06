import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from '../../components/overlay/DropZone/DropZone'
import { Toast } from '../../components/overlay/Toast/Toast'
import { buildLibrary } from '../../model/library'
import { PINNED_PROJECTS, PINNED_TAGS, TODAY, sampleLibrary } from '../../samples/library'
import { AppBar } from '../AppBar'
import { ScreenFrame } from '../ScreenFrame'
import type { JSX } from 'solid-js'
import { EditionScreen } from './EditionScreen'

const meta = {
  title: '画面/00 ホーム',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const edition = (
  o: {
    scrollTop?: number
    pinsOpen?: boolean
    extra?: JSX.Element
    toast?: JSX.Element
  } = {},
) => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame bar={<AppBar lib={lib} />} toast={o.toast}>
      <EditionScreen
        lib={lib}
        pinnedProjects={PINNED_PROJECTS}
        pinnedTags={PINNED_TAGS}
        pinsOpen={o.pinsOpen}
        scrollTop={o.scrollTop}
      />
      {o.extra}
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => edition() }
export const PinsOpen: Story = {
  name: 'ピン留めを全件表示',
  render: () => edition({ pinsOpen: true }),
}
export const Scrolled: Story = {
  name: 'スクロール後',
  render: () => edition({ scrollTop: 1100 }),
}
export const Narrow: Story = {
  name: '狭いウィンドウ',
  decorators: [
    (Story) => (
      <div style={{ width: '900px' }}>
        <Story />
      </div>
    ),
  ],
  render: () => edition(),
}
export const Drop: Story = {
  name: '08 ファイルをドラッグ中',
  render: () =>
    edition({
      extra: <DropZone title="12 件のファイルを取り込む" sub="ドロップして所属なしで取り込みます" />,
    }),
}
export const Empty: Story = {
  name: '08 まだ項目がない',
  render: () => {
    const lib = buildLibrary([], [], TODAY)
    return (
      <ScreenFrame bar={<AppBar lib={lib} />}>
        <EditionScreen lib={lib} location="D:\Library\Example" />
      </ScreenFrame>
    )
  },
}
export const LoadError: Story = {
  name: '08 一部の読み込みに失敗',
  render: () =>
    edition({
      toast: (
        <Toast message="3 件のノートを読み込めませんでした" actionLabel="確認" onAction={() => {}} onClose={() => {}} />
      ),
    }),
}
