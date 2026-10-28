import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Icon } from '../../base/Icon/Icon'
import { IconButton } from '../../controls/IconButton/IconButton'

const meta = {
  title: '部品/overlay/Tooltip',
  parameters: {
    docs: {
      description: { component: 'data-tip を付けた要素にカーソルを止めると出る。TooltipHost は preview で置いている' },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <IconButton label="再生（Space）">
        <Icon name="play" />
      </IconButton>
      <IconButton label="消音（M）">
        <Icon name="volume" />
      </IconButton>
      <IconButton label="全画面">
        <Icon name="fullscreen" />
      </IconButton>
    </div>
  ),
}
export const Long: Story = {
  name: '長い文言',
  render: () => (
    <span data-tip="C:\Users\fof\Documents\Project\patchouli\example\dev-library\2025 春の企画\spring-poster.png">
      spring-poster.png
    </span>
  ),
}
