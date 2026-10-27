import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { ThumbMakingProvider } from '../components/media/Thumb/Thumb'
import type { Activity } from '../components/nav/ActivityButton/ActivityButton'
import { WindowProvider } from '../components/nav/TitleBar/TitleBar'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from '../samples/library'
import { AppBar, type AppBarProps } from './AppBar'
import { EditionScreen } from './Edition/EditionScreen'
import { ScreenFrame } from './ScreenFrame'

const meta = {
  title: '画面/タイトルバー',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

/** ホームの上にタイトルバーを置いた見た目。メニューや検索はホームに重ねて出す。 */
const bar = (o: Partial<AppBarProps> = {}) => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame bar={<AppBar lib={lib} here="home" crumbs={['ホーム']} {...o} />}>
      <EditionScreen lib={lib} pinnedProjects={PINNED_PROJECTS} pinnedTags={PINNED_TAGS} />
    </ScreenFrame>
  )
}

const desktop = (Story: () => JSX.Element) => (
  <WindowProvider
    value={{ maximized: () => false, onMinimize: () => {}, onToggleMaximize: () => {}, onClose: () => {} }}
  >
    <Story />
  </WindowProvider>
)

export const Default: Story = { name: 'web（窓のボタンなし）', render: () => bar() }
export const Desktop: Story = { name: 'デスクトップ', decorators: [desktop], render: () => bar() }
export const Crumbs: Story = {
  name: '戻ると道のり',
  render: () => bar({ here: 'projects', crumbs: ['プロジェクト一覧', '秋の企画'], onBack: () => {} }),
}
export const Places: Story = {
  name: 'いまの場所から画面を選ぶ',
  render: () => bar({ initial: 'places' }),
}
export const Menu: Story = { name: 'メニュー', render: () => bar({ initial: 'menu' }) }
export const Search: Story = { name: '検索を開く', render: () => bar({ initial: 'search' }) }
export const Typing: Story = { name: '検索に入力中', render: () => bar({ initial: 'search', query: '配色' }) }
export const Prompt: Story = { name: 'プロンプト', render: () => bar({ initial: 'prompt' }) }
export const Help: Story = { name: 'キー操作の一覧', render: () => bar({ initial: 'help' }) }

const working: Activity[] = [
  { key: 'check', icon: 'sync', label: 'ライブラリとファイルを突き合わせ中' },
  { key: 'thumbs', icon: 'image', label: 'サムネイルと波形を作成中', done: 28, total: 40, onStop: () => {} },
]
/** 裏で処理が動いているあいだ。サムネイルを作っている素材には、仮の絵に回る印が出る。押すと一覧を開く。 */
export const Working: Story = {
  name: '裏で処理中',
  render: () => {
    const making = new Set(
      sampleLibrary()
        .items.filter((it) => !it.note)
        .slice(0, 6)
        .map((it) => it.id),
    )
    return <ThumbMakingProvider value={(id) => making.has(id)}>{bar({ activities: working })}</ThumbMakingProvider>
  },
}
export const ReadOnly: Story = { name: '書き込めない保存先', render: () => bar({ readOnly: true }) }

const developer: AppBarProps['developer'] = {
  get: async () => ({ enabled: true, pluginDirs: ['D:\\dev\\patchouli-plugins'], repos: [] }),
  set: async () => {},
  pick: async () => undefined,
}
/** デスクトップでは、設定に開発者モードが出る。 */
export const Settings: Story = {
  name: '設定',
  decorators: [desktop],
  render: () => bar({ initial: 'settings', developer }),
}
