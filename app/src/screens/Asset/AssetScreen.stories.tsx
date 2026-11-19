import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { type Item, withChanged } from '../../model/library'
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
export const Details: StoryObj<Pick<AssetScreenProps, 'onRename'>> = {
  name: 'ファイルの詳細',
  args: { onRename: fn() },
  render: (args) => {
    const [lib, setLib] = createSignal(sampleLibrary())
    const list = lib()
      .inProject('秋の企画')
      .filter((i) => !i.note)
      .map((i) => i.id)
    const onRename = (id: string, name: string) => {
      args.onRename?.(id, name)
      const it = lib().byId.get(id)
      if (it) setLib(withChanged(lib(), [{ ...it, name }], []))
    }
    return (
      <ScreenFrame>
        <AssetScreen
          lib={lib()}
          list={list}
          infoOpen
          onRename={onRename}
          host={{
            view: async () => null,
            details: async () => ({
              size: 4_718_592,
              rows: [
                { label: 'BPM', value: '128' },
                { label: '再生時間', value: '3:42' },
              ],
            }),
          }}
        />
      </ScreenFrame>
    )
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText('ファイルの詳細'))
    await expect(await canvas.findByText('4.5 MB')).toBeInTheDocument()
    await expect(await canvas.findByText('128')).toBeInTheDocument()
    const name = canvas.getByRole('textbox', { name: '名前' })
    await userEvent.clear(name)
    await userEvent.type(name, '新しい名前{Enter}')
    await expect(args.onRename).toHaveBeenCalledWith(expect.any(String), '新しい名前')
    await expect(name).toHaveValue('新しい名前')
  },
}
export const Tags: Story = {
  name: 'タグを選択',
  render: () => {
    const [lib, setLib] = createSignal(sampleLibrary())
    const list = lib()
      .inProject('秋の企画')
      .filter((i) => !i.note)
      .map((i) => i.id)
    const onTag = (id: string, tag: string, on: boolean) => {
      const l = lib()
      const it = l.byId.get(id)
      if (it) setLib(withChanged(l, [{ ...it, tags: on ? [...it.tags, tag] : it.tags.filter((t) => t !== tag) }], []))
    }
    return (
      <ScreenFrame>
        <AssetScreen
          lib={lib()}
          list={list}
          infoOpen
          onTag={onTag}
          recentTags={['資料', '写真/旅行']}
          suggestTags={async () => ['紅葉', '逆光', '写真/旅行']}
        />
      </ScreenFrame>
    )
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: '追加' }))
    const picker = await canvas.findByRole('dialog', { name: 'タグを選択' })
    await expect(await within(picker).findByRole('checkbox', { name: /紅葉/ })).toBeInTheDocument()
  },
}
export const Idle: Story = { name: '何も触っていない', render: () => asset({ idle: true }) }

const done = async () => {}

const unsupported = (o: Partial<AssetScreenProps> = {}) => {
  const lib = sampleLibrary()
  const list = lib.inProject('秋の企画').filter((i) => !i.note)
  const at = list.findIndex((i) => i.ext === 'ai')
  return (
    <ScreenFrame>
      <AssetScreen
        lib={lib}
        list={list.map((i) => i.id)}
        index={at}
        onOpenPlugins={() => {}}
        onReveal={done}
        onOpenDefault={done}
        onEnablePlugin={done}
        {...o}
      />
    </ScreenFrame>
  )
}

export const Unsupported: Story = { name: '対応するプラグインがない', render: () => unsupported() }
export const Disabled: Story = {
  name: '対応するプラグインが無効',
  render: () =>
    unsupported({ blocker: async () => ({ id: 'photoshop', name: 'Photoshop', dev: false, state: 'disabled' }) }),
}

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
  name: '動画を再生',
  render: () => withFile('clip-0412', 'clip-0412.mp4', { kind: 'video' }),
}
export const Image: Story = {
  name: '画像の表示倍率を変更',
  render: () => withFile('IMG_3310', 'IMG_3310.jpg', { kind: 'image' }),
}
export const Audio: Story = {
  name: '音声を再生',
  render: () =>
    withFile('voice-1019', 'voice-1019.mp3', { kind: 'audio' }, async () =>
      Uint8Array.from({ length: 4000 }, (_, i) => 255 * Math.abs(Math.sin((Math.PI * i) / 450))),
    ),
}
export const AudioJacket: Story = {
  name: 'ジャケット付きの音声を再生',
  render: () => {
    const lib = sampleLibrary()
    const it = lib.items.find((i) => i.name === 'voice-1019')
    if (it) Object.assign(it, { src: '/dev-library/voice-1019.mp3', thumb: '/dev-library/IMG_3310.jpg' })
    return (
      <ScreenFrame>
        <AssetScreen
          lib={lib}
          list={it ? [it.id] : []}
          host={{
            view: async () => ({ kind: 'audio' }),
            waveform: async () =>
              Uint8Array.from({ length: 4000 }, (_, i) => 255 * Math.abs(Math.sin((Math.PI * i) / 450))),
          }}
        />
      </ScreenFrame>
    )
  },
}
export const Rename: Story = {
  name: '名前を変更して再読み込み',
  render: () => {
    const files: Record<string, [string, ItemView]> = {
      IMG_3310: ['IMG_3310.jpg', { kind: 'image' }],
      'clip-0412': ['clip-0412.mp4', { kind: 'video' }],
      'voice-1019': ['voice-1019.mp3', { kind: 'audio' }],
    }
    const first = sampleLibrary()
    const views = new Map<string, ItemView>()
    for (const it of first.items) {
      const f = files[it.name]
      if (!f) continue
      it.src = `/dev-library/${f[0]}`
      views.set(it.id, f[1])
    }
    const [lib, setLib] = createSignal(first)
    // アプリと同じく、名前を先に変え、ファイルを動かし終えてから src を替える
    const put = (id: string, change: Partial<Item>) => {
      const it = lib().byId.get(id)
      if (it) setLib(withChanged(lib(), [{ ...it, ...change }], []))
    }
    const onRename = (id: string, name: string) => {
      put(id, { name })
      const src = lib().byId.get(id)?.src?.split('?')[0]
      setTimeout(() => put(id, { src: `${src}?name=${encodeURIComponent(name)}` }), 300)
    }
    return (
      <ScreenFrame>
        <AssetScreen
          lib={lib()}
          list={[...views.keys()]}
          infoOpen
          onRename={onRename}
          host={{
            view: async (id) => views.get(id) ?? null,
            waveform: async () =>
              Uint8Array.from({ length: 4000 }, (_, i) => 255 * Math.abs(Math.sin((Math.PI * i) / 450))),
          }}
        />
      </ScreenFrame>
    )
  },
}
