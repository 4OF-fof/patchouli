import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { type Notices, NoticesDialog } from './NoticesDialog'

const MIT = (who: string) =>
  `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software…`

const notices: Notices = {
  self: { name: 'Patchouli', license: 'MIT', text: MIT('2026 4OF') },
  entries: [
    { name: 'selectors', version: '0.38.0', license: 'MPL-2.0', url: 'https://github.com/servo/stylo', texts: [] },
    { name: 'serde', version: '1.0.228', license: 'MIT', texts: [1] },
    { name: 'solid-js', version: '1.9.10', license: 'MIT', texts: [0] },
    { name: 'tauri', version: '2.9.5', license: 'MIT', texts: [2] },
  ],
  texts: [MIT('2016-2025 Ryan Carniato'), MIT('2014 The Rust Project Developers'), MIT('2017 - Present Tauri Apps')],
}

const meta = {
  title: '部品/overlay/NoticesDialog',
  component: NoticesDialog,
  parameters: { layout: 'fullscreen' },
  args: { notices, onClose: () => {} },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '560px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NoticesDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = { name: '読み込み中', args: { notices: undefined } }
