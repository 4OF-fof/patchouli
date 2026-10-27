import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import { ICON_NAMES, Icon } from './Icon'

const meta = {
  title: '部品/base/Icon',
  component: Icon,
  args: { name: 'pin' },
} satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const All: Story = {
  name: 'すべて',
  render: () => (
    <div style={{ display: 'grid', 'grid-template-columns': 'repeat(6, 96px)', gap: '16px 8px' }}>
      <For each={ICON_NAMES}>
        {(n) => (
          <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '6px' }}>
            <Icon name={n} />
            <span style={{ 'font-size': 'var(--fs-tiny)', color: 'var(--muted)' }}>{n}</span>
          </div>
        )}
      </For>
    </div>
  ),
}

/** 小さいほど線を太くする。 */
export const Sizes: Story = {
  name: '大きさと線の太さ',
  render: () => (
    <div style={{ display: 'flex', 'align-items': 'flex-end', gap: '20px' }}>
      <For each={[12, 14, 16, 20, 24]}>
        {(s) => (
          <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '6px' }}>
            <Icon name="folder" size={s} />
            <span style={{ 'font-size': 'var(--fs-tiny)', color: 'var(--muted)' }}>{s}</span>
          </div>
        )}
      </For>
    </div>
  ),
}
