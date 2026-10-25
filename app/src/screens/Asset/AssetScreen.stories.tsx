import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { sampleLibrary } from '../../samples/library'
import { ScreenFrame } from '../ScreenFrame'
import { AssetScreen, type AssetScreenProps } from './AssetScreen'

const meta = {
  title: '画面/04 素材',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

/** 秋の企画の素材を並びにして、moodboard-01 を開く。 */
const asset = (o: Partial<AssetScreenProps> = {}) => {
  const lib = sampleLibrary()
  const list = lib.inProject('秋の企画').filter((i) => !i.note)
  return (
    <ScreenFrame>
      <AssetScreen lib={lib} list={list.map((i) => i.id)} index={0} {...o} />
    </ScreenFrame>
  )
}

export const Default: Story = { render: () => asset() }
export const Info: Story = { name: '情報を開く', render: () => asset({ infoOpen: true }) }
export const Idle: Story = { name: '何も触っていない', render: () => asset({ idle: true }) }
