import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { sampleBackend } from '../../backend/sample'
import type { ArchiveActions } from '../../backend/types'
import { archiveTree } from '../../model/archive'
import type { Library } from '../../model/library'
import { sampleLibrary } from '../../samples/library'
import { ScreenFrame } from '../ScreenFrame'
import { ArchiveScreen, type ArchiveScreenProps } from './ArchiveScreen'
import { EntryScreen } from './EntryScreen'

const meta = {
  title: '画面/05 アーカイブ',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

const NAME = '入稿データ'
const idOf = (lib: Library) => lib.items.find((i) => i.name === NAME)?.id ?? ''
const sample = (): ArchiveActions => {
  const actions = sampleBackend().archive
  if (!actions) throw new Error('サンプルに archive がない')
  return actions
}

const archive = (o: Partial<ArchiveScreenProps> = {}) => {
  const lib = sampleLibrary()
  return (
    <ScreenFrame>
      <ArchiveScreen
        lib={lib}
        id={idOf(lib)}
        name={NAME}
        path="入稿データ"
        actions={sample()}
        onInfo={() => {}}
        {...o}
      />
    </ScreenFrame>
  )
}

export const Default: Story = { name: 'フォルダとファイル', render: () => archive() }
export const Folder: Story = { name: 'サブフォルダ', render: () => archive({ path: '入稿データ/画像' }) }
export const Loading: Story = {
  name: '読み込み中',
  render: () => archive({ actions: { ...sample(), entries: () => new Promise(() => {}) } }),
}
export const Failed: Story = {
  name: '読み込みに失敗',
  render: () =>
    archive({
      actions: { ...sample(), entries: () => Promise.reject(new Error('パスワード付きのアーカイブは開けません')) },
    }),
}
export const Empty: Story = {
  name: 'ファイルなし',
  render: () => archive({ path: '', actions: { ...sample(), entries: async () => [] } }),
}
export const Encrypted: Story = {
  name: 'パスワード付きのファイル',
  render: () =>
    archive({
      actions: {
        ...sample(),
        entries: async () => [{ path: '入稿データ/見積書.pdf', size: 248_000, encrypted: true }],
      },
    }),
}

export const ThumbFailed: Story = {
  name: 'サムネイルの生成に失敗',
  render: () =>
    archive({
      path: '入稿データ/画像',
      actions: {
        ...sample(),
        thumbs: async (_id, paths, onThumb) => paths.forEach((path) => onThumb({ path, failed: true })),
      },
    }),
}
export const ThumbMaking: Story = {
  name: 'サムネイルの生成中',
  render: () => archive({ path: '入稿データ/画像', actions: { ...sample(), thumbs: () => new Promise(() => {}) } }),
}

const entryOf = (path: string, size: number) => {
  const lib = sampleLibrary()
  const { files } = archiveTree(
    idOf(lib),
    [{ path, size, encrypted: false, executable: path.endsWith('.exe') }],
    lib.formats,
  )
  return { lib, items: [...files.values()] }
}
export const NoteEntry: Story = {
  name: 'アーカイブ内のノート',
  render: () => {
    const { lib, items } = entryOf('入稿データ/入稿メモ.md', 2_048)
    return (
      <ScreenFrame>
        <EntryScreen lib={lib} items={items} index={0} host={{ view: async () => null }} actions={sample()} />
      </ScreenFrame>
    )
  },
}
export const Executable: Story = {
  name: '実行形式のファイル',
  render: () => {
    const { lib, items } = entryOf('入稿データ/setup.exe', 2_048_000)
    return (
      <ScreenFrame>
        <EntryScreen
          lib={lib}
          items={items}
          index={0}
          host={{ view: async () => null }}
          actions={sample()}
          onOpenDefault={async () => {}}
        />
      </ScreenFrame>
    )
  },
}
export const Extracting: Story = {
  name: 'ファイルの取り出し中',
  render: () => {
    const { lib, items } = entryOf('入稿データ/画像/IMG_2041.jpg', 3_145_728)
    return (
      <ScreenFrame>
        <EntryScreen
          lib={lib}
          items={items}
          index={0}
          host={{ view: async () => ({ kind: 'image' }) }}
          actions={{ ...sample(), extract: () => new Promise(() => {}) }}
        />
      </ScreenFrame>
    )
  },
}

export const Entry: Story = {
  name: '内容のファイルの情報',
  render: () => {
    const lib = sampleLibrary()
    const id = idOf(lib)
    const { files } = archiveTree(
      id,
      [{ path: '入稿データ/画像/IMG_2041.jpg', size: 3_145_728, encrypted: false }],
      lib.formats,
    )
    return (
      <ScreenFrame>
        <EntryScreen
          lib={lib}
          items={[...files.values()].map((it) => ({ ...it, src: lib.items.find((x) => x.name === it.name)?.src }))}
          index={0}
          infoOpen
          host={{ view: async () => ({ kind: 'image' }), details: async () => ({ size: 3_145_728, rows: [] }) }}
          actions={sample()}
        />
      </ScreenFrame>
    )
  },
}
