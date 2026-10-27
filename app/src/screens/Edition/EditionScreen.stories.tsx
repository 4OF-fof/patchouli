import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DropZone } from '../../components/overlay/DropZone/DropZone'
import { Toast } from '../../components/overlay/Toast/Toast'
import { buildLibrary } from '../../model/library'
import { PINNED_PROJECTS, PINNED_TAGS, TODAY, sampleLibrary } from '../../samples/library'
import { AppBar, type BarState } from '../AppBar'
import { ScreenFrame } from '../ScreenFrame'
import type { JSX } from 'solid-js'
import { EditionScreen } from './EditionScreen'

const meta = {
  title: '画面/00 ホーム',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

/** ホームに検索バーを重ねた、アプリを開いたときの見た目。 */
const edition = (
  o: {
    bar?: BarState
    query?: string
    scrollTop?: number
    readOnly?: boolean
    pinsOpen?: boolean
    extra?: JSX.Element
    toast?: JSX.Element
  } = {},
) => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame
      bar={<AppBar lib={lib} here="home" crumbs={['ホーム']} initial={o.bar} query={o.query} readOnly={o.readOnly} />}
      toast={o.toast}
    >
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
export const Search: Story = {
  name: '検索を開く',
  render: () => edition({ bar: 'search' }),
}
export const Typing: Story = {
  name: '検索に入力中',
  render: () => edition({ bar: 'search', query: '配色' }),
}
export const Prompt: Story = {
  name: 'プロンプト',
  render: () => edition({ bar: 'prompt' }),
}
export const Menu: Story = {
  name: 'メニューを開く',
  render: () => edition({ bar: 'menu' }),
}
export const Settings: Story = {
  name: 'メニュー · 設定',
  render: () => edition({ bar: 'settings' }),
}
export const Help: Story = {
  name: 'キー操作の一覧',
  render: () => edition({ bar: 'help' }),
}
export const Drop: Story = {
  name: '08 ファイルを持ってきた',
  render: () =>
    edition({
      extra: <DropZone title="12 件のファイルを取り込む" sub="ドロップしてプロジェクト未指定で取り込みます" />,
    }),
}
export const ReadOnly: Story = {
  name: '08 書き込めない保存先',
  render: () => edition({ readOnly: true }),
}
export const Empty: Story = {
  name: '08 まだ何もない',
  render: () => {
    const lib = buildLibrary([], [], TODAY)
    return (
      <ScreenFrame bar={<AppBar lib={lib} here="home" crumbs={['ホーム']} />}>
        <EditionScreen lib={lib} location="D:\Library\Example" />
      </ScreenFrame>
    )
  },
}
export const LoadError: Story = {
  name: '08 一部を読み込めない',
  render: () =>
    edition({
      toast: (
        <Toast message="3 件のノートを読み込めませんでした" actionLabel="見る" onAction={() => {}} onClose={() => {}} />
      ),
    }),
}
