import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import { ItemCard } from '../ItemCard/ItemCard'
import { JustifiedRow } from './JustifiedRow'

const ITEMS: { name: string; hue: number; ratio: number; note?: boolean; excerpt?: string }[] = [
  { name: '夕方の港', hue: 205, ratio: 1.5 },
  { name: '路地の看板', hue: 20, ratio: 0.75 },
  {
    name: '配色のメモ',
    hue: 0,
    ratio: 1,
    note: true,
    excerpt: '彩度を落とした青を基調に、差し色を一点だけ使う。',
  },
  { name: '波の音', hue: 150, ratio: 1.78 },
  { name: '朝の市場', hue: 40, ratio: 1.33 },
  { name: '試し撮り', hue: 260, ratio: 1.78 },
  { name: '窓辺', hue: 180, ratio: 0.8 },
  { name: '石畳', hue: 30, ratio: 1.5 },
  { name: '看板の書体', hue: 330, ratio: 1 },
  { name: '曇りの海', hue: 215, ratio: 1.6 },
  { name: '古い時計', hue: 50, ratio: 0.9 },
  { name: '港の地図', hue: 120, ratio: 1.4 },
]

const meta = {
  title: '部品/media/JustifiedRow',
  component: JustifiedRow,
  args: { height: 118, gap: 6 },
  decorators: [
    (Story) => (
      <div style={{ width: '960px' }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <JustifiedRow {...args}>
      <For each={ITEMS}>{(it) => <ItemCard {...it} showName={false} />}</For>
    </JustifiedRow>
  ),
} satisfies Meta<typeof JustifiedRow>
export default meta
type Story = StoryObj<typeof meta>

/** ホーム「今週」 */
export const ThisWeek: Story = {}
/** ホーム「今月」 */
export const ThisMonth: Story = { args: { height: 76, gap: 5 } }
/** ホーム「静かなもの」 */
export const Quiet: Story = { args: { height: 56, gap: 4 } }
export const SingleLine: Story = { args: { height: 196, singleLine: true } }
