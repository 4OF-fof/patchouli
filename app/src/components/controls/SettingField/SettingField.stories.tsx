import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { SettingField } from './SettingField'

const meta = {
  title: '部品/controls/SettingField',
  component: SettingField,
  decorators: [
    (Story) => (
      <div style={{ width: '420px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingField>
export default meta
type Story = StoryObj<typeof meta>

export const Toggle: Story = {
  args: { setting: { key: 'wrap', label: '行を折り返す', kind: 'toggle', default: true, value: true } },
}
export const Number: Story = {
  args: {
    setting: {
      key: 'size',
      label: '文字サイズ',
      help: '10〜32 px',
      kind: 'number',
      min: 10,
      max: 32,
      step: 1,
      default: 14,
      value: 16,
    },
  },
}
export const Text: Story = {
  args: { setting: { key: 'prefix', label: '接頭辞', kind: 'text', default: '', value: '# ' } },
}
export const Choice: Story = {
  args: {
    setting: {
      key: 'font',
      label: 'フォント',
      kind: 'choice',
      choices: [
        { value: 'mono', label: '等幅' },
        { value: 'sans', label: 'ゴシック' },
      ],
      default: 'mono',
      value: 'sans',
    },
  },
}
