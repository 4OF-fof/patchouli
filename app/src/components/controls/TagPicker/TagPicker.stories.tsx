import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent } from 'storybook/test'
import { TagPicker, type TagPickerProps } from './TagPicker'

const meta = {
  title: '部品/controls/TagPicker',
  args: { onToggle: fn(), onClose: fn() },
} satisfies Meta<TagPickerProps>
export default meta
type Story = StoryObj<TagPickerProps>

const ALL = ['写真', '写真/旅行', '写真/街', '人物', '人物/横顔', '参考', '小物', '空', '空/雲', '背景', '風景', '夕方']

const picker = (args: TagPickerProps, o: Partial<TagPickerProps> = {}) => {
  const [tags, setTags] = createSignal(['風景'])
  return (
    <TagPicker
      all={ALL}
      recent={['風景', '小物', '人物/横顔']}
      suggested={['夕方', '空/雲', '逆光']}
      {...o}
      tags={tags()}
      onToggle={(t, on) => {
        args.onToggle(t, on)
        setTags(on ? [...tags(), t] : tags().filter((x) => x !== t))
      }}
      onClose={args.onClose}
    />
  )
}

export const Default: Story = {
  render: (args) => picker(args),
  play: async ({ args, canvas }) => {
    const [first] = canvas.getAllByRole('checkbox', { name: '夕方' })
    await userEvent.click(first)
    await expect(args.onToggle).toHaveBeenCalledWith('夕方', true)
    for (const b of canvas.getAllByRole('checkbox', { name: '夕方' })) await expect(b).toBeChecked()
  },
}

export const Loading: Story = { name: 'おすすめを取得中', render: (args) => picker(args, { suggested: undefined }) }

export const Empty: Story = {
  name: 'タグがまだない',
  render: (args) => picker(args, { all: [], recent: [], suggested: [] }),
}

export const Create: Story = {
  name: '新しいタグを作る',
  render: (args) => picker(args),
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'タグを探す・作る' }), '# 逆光')
    await userEvent.click(canvas.getByRole('button', { name: /新しいタグとして付ける/ }))
    await expect(args.onToggle).toHaveBeenCalledWith('逆光', true)
  },
}

export const Close: Story = {
  name: 'Esc で閉じる',
  render: (args) => picker(args),
  play: async ({ args }) => {
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
  },
}
