import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn } from 'storybook/test'
import { ReloadOverlay } from './ReloadOverlay'

const meta = {
  title: '部品/overlay/ReloadOverlay',
  component: ReloadOverlay,
  parameters: { layout: 'fullscreen' },
  args: { step: 'load', onWait: fn(), onStop: fn(), onCancel: fn() },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: '100vh', 'min-height': '480px', background: 'var(--paper)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReloadOverlay>
export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = { name: '読み込み中' }

/** 裏の処理が残っているときは、待つか中止するかを選ぶ。 */
export const Ask: Story = {
  name: '処理が残っている',
  args: { step: 'ask', work: 12 },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '完了まで待機' }))
    await expect(args.onWait).toHaveBeenCalled()
  },
}

export const Waiting: Story = {
  name: '完了を待機中',
  args: { step: 'wait', work: 5 },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '処理を中止' }))
    await expect(args.onStop).toHaveBeenCalled()
  },
}
