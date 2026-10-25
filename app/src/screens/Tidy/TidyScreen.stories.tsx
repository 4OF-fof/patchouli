import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { sampleLibrary } from '../../samples/library'
import { ScreenFrame } from '../ScreenFrame'
import { TidyScreen } from './TidyScreen'

const meta = {
  title: '画面/02 整理',
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
/** 先頭の 3 件を承認したあと、別の候補（UI）の 1 件を見ている。 */
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
  name: 'すべて終わった',
  render: () => {
    const lib = sampleLibrary()
    return (
      <ScreenFrame>
        <TidyScreen lib={lib} approved={lib.pending().map((i) => i.id)} />
      </ScreenFrame>
    )
  },
}
