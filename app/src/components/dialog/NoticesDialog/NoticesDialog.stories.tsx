import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { type Notices, NoticesDialog } from './NoticesDialog'

const MIT =
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction…'

const notices: Notices = {
  self: { name: 'Patchouli', license: 'MIT', text: `MIT License\n\nCopyright (c) 2026 4OF\n\n${MIT}` },
  texts: { MIT },
  groups: [
    {
      license: 'MIT',
      entries: [
        { name: 'chrono', version: '0.4.45', copyright: [], url: 'https://github.com/chronotope/chrono' },
        { name: 'serde', version: '1.0.228', copyright: [] },
        { name: 'solid-js', version: '1.9.10', copyright: ['Copyright (c) 2016-2025 Ryan Carniato'] },
        {
          name: 'tauri',
          version: '2.9.5',
          copyright: ['Copyright (c) 2017 - Present Tauri Apps Contributors'],
        },
      ],
    },
    {
      license: 'MPL-2.0',
      entries: [{ name: 'selectors', version: '0.38.0', copyright: [], url: 'https://github.com/servo/stylo' }],
    },
  ],
}

const meta = {
  title: '部品/dialog/NoticesDialog',
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
