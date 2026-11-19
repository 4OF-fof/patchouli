import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TextList } from './TextList'

const meta = {
  title: '部品/controls/TextList',
  component: TextList,
  args: { values: ['秋の配色', 'セージの配色'], name: '別名', onChange: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: '320px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => {
    const [values, setValues] = createSignal(args.values)
    return <TextList {...args} values={values()} onChange={setValues} />
  },
}
export const Empty: Story = { ...Default, args: { values: [] } }
