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
  name: '道のり',
  render: () => bar({ here: 'projects', crumbs: ['プロジェクト一覧', '秋の企画'] }),
}
export const Places: Story = {
  name: 'いまの場所から画面を選ぶ',
  render: () => bar(),
  play: ({ canvasElement }) => canvasElement.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click(),
}
export const Menu: Story = { name: 'メニュー', render: () => bar({ initial: 'menu' }) }
const recent = sampleLibrary()
  .items.slice(0, 5)
  .map((it) => it.id)
export const Search: Story = { name: '検索を開く', render: () => bar({ initial: 'search', recent }) }
export const Typing: Story = { name: '検索に入力中', render: () => bar({ initial: 'search', query: '配色' }) }
export const TypingTag: Story = { name: '検索でタグを入力中', render: () => bar({ initial: 'search', query: '#配' }) }
export const Command: Story = { name: '操作を検索', render: () => bar({ initial: 'command' }) }
const contentSearch: AppBarProps['contentSearch'] = {
  prepare: () => new Promise((r) => setTimeout(r, 1200)),
  search: async () =>
    sampleLibrary()
      .items.filter((it) => !it.note)
      .slice(0, 6)
      .map((it, i) => ({ id: it.id, score: 0.62 - i * 0.04, at: i % 2 ? i * 95 : undefined })),
}
export const Prompt: Story = {
  name: '内容で検索',
  render: () => bar({ initial: 'prompt', query: '夕焼けの海', contentSearch }),
}
const autoTag: AppBarProps['autoTag'] = {
  get: async () => ({
    enabled: true,
    installed: true,
    downloading: false,
    need: 0,
    gpus: [],
    suggest: 'confirm',
    search: true,
  }),
  set: async () => {},
  cancelDownload: async () => {},
  setSuggest: async () => {},
  setSearch: async () => {},
  onProgress: () => () => {},
}
export const SearchAi: Story = {
  name: '検索を開く（AI 機能が有効）',
  render: () => bar({ initial: 'search', contentSearch, autoTag }),
}
export const PromptPreparing: Story = {
  name: '内容で検索（準備中）',
  render: () =>
    bar({
      initial: 'prompt',
      query: '夕焼けの海',
      contentSearch: { ...contentSearch, prepare: () => new Promise(() => {}) },
    }),
}
export const PromptNone: Story = {
  name: '内容で検索（一致なし）',
  render: () =>
    bar({ initial: 'prompt', query: '夕焼けの海', contentSearch: { prepare: async () => {}, search: async () => [] } }),
}
export const Help: Story = { name: 'キー操作の一覧', render: () => bar({ initial: 'help' }) }

const working: Activity[] = [
  { key: 'check', icon: 'sync', label: 'ライブラリの整合性を確認中' },
  { key: 'thumbs', icon: 'image', label: 'サムネイルを作成中', done: 28, total: 40, onStop: () => {} },
  { key: 'waves', icon: 'audio', label: '音声を解析中', done: 3, total: 12, onStop: () => {} },
]
export const Working: Story = {
  name: '処理中',
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

const developer: AppBarProps['developer'] = {
  get: async () => ({ enabled: true, pluginDirs: ['D:\\dev\\patchouli-plugins'], repos: [] }),
  set: async () => {},
  pick: async () => undefined,
}
export const Settings: Story = {
  name: '設定',
  decorators: [desktop],
  render: () => bar({ initial: 'settings', developer }),
}
