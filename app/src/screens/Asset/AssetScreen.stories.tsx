import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { ItemView } from '../../plugins/types'
import { sampleLibrary } from '../../samples/library'
import { ScreenFrame } from '../ScreenFrame'
import { AssetScreen, type AssetScreenProps, type AssetViewHost } from './AssetScreen'

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

/**
 * 中身を出すときの見た目。中身は動作確認用のライブラリ（scripts/dev-library.ts が作る）のもので、なければ出ない。
 * 見本の項目に、そのファイルの URL を付けて開く。
 */
const withFile = (name: string, file: string, view: ItemView, waveform?: AssetViewHost['waveform']) => {
  const lib = sampleLibrary()
  const it = lib.items.find((i) => i.name === name)
  if (it) it.src = `/dev-library/${file}`
  return (
    <ScreenFrame>
      <AssetScreen lib={lib} list={it ? [it.id] : []} host={{ view: async () => view, waveform }} />
    </ScreenFrame>
  )
}

export const Video: Story = {
  name: '動画を再生する',
  render: () => withFile('clip-0412', 'clip-0412.mp4', { kind: 'video' }),
}
export const Image: Story = {
  name: '画像の倍率を変える',
  render: () => withFile('IMG_3310', 'IMG_3310.jpg', { kind: 'image' }),
}
export const Audio: Story = {
  name: '音声を再生する',
  render: () =>
    withFile('voice-1019', 'voice-1019.mp3', { kind: 'audio' }, async () =>
      Uint8Array.from({ length: 4000 }, (_, i) => Math.round(255 * Math.abs(Math.sin((Math.PI * i) / 900)))),
    ),
}
