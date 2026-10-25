import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, onCleanup } from 'solid-js'
import { NavMenu } from '../NavMenu/NavMenu'
import { MAIN_ITEMS, SETTINGS_ITEMS } from '../NavMenu/NavMenu.samples'
import { ResultHeading, ResultRow } from '../ResultRow/ResultRow'
import { type DockMode, SearchDock } from './SearchDock'

const recent = () => (
  <>
    <ResultHeading>プロジェクト</ResultHeading>
    <ResultRow kind="project" title="秋の企画" sub="32 件 · 最後に扱った 2 日前" selected />
    <ResultRow kind="project" title="日記" sub="64 件 · 最後に扱った 今日" />
    <ResultHeading>項目</ResultHeading>
    <ResultRow kind="note" title="配色のメモ" sub="最近 · 秋の企画" />
    <ResultRow kind="asset" title="夕方の港" sub="最近 · 秋の企画" thumb={{ hue: 205 }} />
    <ResultRow kind="asset" title="路地の看板" sub="最近 · 日記" thumb={{ hue: 20 }} />
  </>
)

const typed = () => (
  <>
    <ResultHeading>項目</ResultHeading>
    <ResultRow
      kind="note"
      title={
        <>
          <mark>配色</mark>のメモ
        </>
      }
      sub="秋の企画"
      selected
    />
    <ResultRow kind="create" title="「配色」という名前でノートを作る" />
  </>
)

const meta = {
  title: '部品/検索とメニュー/SearchDock',
  component: SearchDock,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          height: '100vh',
          'min-height': '560px',
          overflow: 'hidden',
          background: 'var(--paper)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchDock>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
export const MenuOpen: Story = {
  args: { menuOpen: true },
  render: (args) => <SearchDock {...args} menu={<NavMenu items={MAIN_ITEMS} />} />,
}
export const MenuSettings: Story = {
  args: { menuOpen: true },
  render: (args) => <SearchDock {...args} menu={<NavMenu items={SETTINGS_ITEMS} />} />,
}
export const OpenEmpty: Story = {
  args: { open: true },
  render: (args) => <SearchDock {...args} results={recent()} />,
}
export const Typing: Story = {
  args: { open: true, query: '配色' },
  render: (args) => <SearchDock {...args} results={typed()} />,
}
export const Prompt: Story = { args: { open: true, mode: 'prompt' } }
export const ReadOnly: Story = { args: { readOnly: true } }

/** 触って確かめる：Ctrl P で開く、Tab で検索とプロンプトを切り替える、Esc で閉じる。 */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false)
    const [mode, setMode] = createSignal<DockMode>('search')
    const [query, setQuery] = createSignal('')
    const [menu, setMenu] = createSignal<'main' | 'settings' | null>(null)
    const close = () => {
      setOpen(false)
      setQuery('')
      setMode('search')
    }
    const onWindowKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setMenu(null)
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onWindowKey)
    onCleanup(() => window.removeEventListener('keydown', onWindowKey))
    return (
      <SearchDock
        open={open()}
        mode={mode()}
        query={query()}
        results={mode() === 'prompt' ? undefined : query() ? typed() : recent()}
        menuOpen={menu() !== null}
        menu={
          <NavMenu
            focusFirst
            items={menu() === 'settings' ? SETTINGS_ITEMS : MAIN_ITEMS}
            onClose={() => setMenu(null)}
            onSelect={(id) => setMenu(id === 'settings' ? 'settings' : id === 'back' ? 'main' : null)}
          />
        }
        onOpen={() => setOpen(true)}
        onClose={close}
        onQueryInput={setQuery}
        onMenuToggle={() => setMenu(menu() ? null : 'main')}
        onInputKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Tab') {
            e.preventDefault()
            setMode(mode() === 'prompt' ? 'search' : 'prompt')
          }
        }}
      />
    )
  },
}
