import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { PluginStatus } from '../../../plugins/types'
import { PluginInstallDialog } from './PluginInstallDialog'

const none = { commands: {}, plugins: {} }

const plugin: PluginStatus = {
  id: 'example.web',
  name: 'Web ページ',
  version: '0.4.0',
  source: { github: 'owner/patchouli-web' },
  tag: 'v0.4.0',
  description: 'Web ページの URL のサムネイルと詳細表示',
  builtin: false,
  dev: false,
  enabled: true,
  state: 'disabled',
  required: none,
  optional: none,
  via: [],
  caps: [],
  formats: [],
  settings: [],
  problems: [],
}

const meta = {
  title: '部品/dialog/PluginInstallDialog',
  component: PluginInstallDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    prepared: {
      token: 'token',
      plugin,
      first: true,
      added: { full: true, permissions: ['library', 'notes'], commands: ['ffmpeg'], fetch: ['www.example.com'] },
    },
    onInstall: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '520px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginInstallDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'インストール' }
export const Update: Story = {
  name: '権限が増えた更新',
  args: {
    prepared: {
      token: 'token',
      plugin,
      first: false,
      added: { full: false, permissions: [], commands: [], fetch: ['api.example.com'] },
    },
  },
}
export const Plain: Story = {
  name: '権限を使わない',
  args: {
    prepared: {
      token: 'token',
      plugin: { ...plugin, source: { local: 'D:\\plugins\\web-0.4.0.zip' }, tag: undefined },
      first: true,
      added: { full: false, permissions: [], commands: [], fetch: [] },
    },
  },
}
