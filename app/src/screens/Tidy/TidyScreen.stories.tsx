import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { withSuggestions } from '../../model/library'
import { sampleLibrary } from '../../samples/library'
import { ScreenFrame } from '../ScreenFrame'
import { TidyScreen } from './TidyScreen'

const meta = {
  title: '画面/02 分類の確認',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <ScreenFrame>
      <TidyScreen lib={sampleLibrary()} />
    </ScreenFrame>
  ),
}
export const Next: Story = {
  name: '別の 1 件',
  render: () => {
    const lib = sampleLibrary()
    const q = lib.pending()
    return (
      <ScreenFrame>
        <TidyScreen
          lib={lib}
          approved={q.slice(0, 3).map((i) => i.id)}
          currentId={lib.byName.get('スクリーンショット 2026-10-03 10.12')?.id}
        />
      </ScreenFrame>
    )
  },
}
export const Done: Story = {
  name: 'すべて完了',
  render: () => {
    const lib = sampleLibrary()
    return (
      <ScreenFrame>
        <TidyScreen lib={lib} approved={lib.pending().map((i) => i.id)} />
      </ScreenFrame>
    )
  },
}
export const Filed: Story = {
  name: 'プロジェクトの項目と候補なし',
  render: () => {
    const base = sampleLibrary()
    const s = Object.fromEntries(base.items.flatMap((i) => (i.suggestion ? [[i.id, i.suggestion]] : [])))
    const n = Object.keys(s).length
    const poster = base.byName.get('ポスター案')
    const scan = base.byName.get('scan-0930')
    if (poster) s[poster.id] = { tags: [{ tag: '配色', conf: '類似度：中', on: true }], order: n }
    if (scan) s[scan.id] = { tags: [], order: n + 1 }
    const lib = withSuggestions(base, s)
    return (
      <ScreenFrame>
        <TidyScreen lib={lib} currentId={scan?.id} />
      </ScreenFrame>
    )
  },
}
