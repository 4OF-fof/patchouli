import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Mosaic } from './Mosaic'

const meta = {
  title: '部品/素材/Mosaic',
  component: Mosaic,
  args: {
    tiles: [{ hue: 205 }, { hue: 20 }, { hue: 150 }, { hue: 40 }, { hue: 260 }],
    height: 220,
  },
  decorators: [
    (Story) => (
      <div style={{ width: '320px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Mosaic>
export default meta
type Story = StoryObj<typeof meta>

export const Five: Story = {}
export const Three: Story = { args: { tiles: [{ hue: 205 }, { hue: 20 }, { hue: 150 }] } }
