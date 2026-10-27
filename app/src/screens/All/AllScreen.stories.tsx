import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { sampleLibrary } from '../../samples/library'
import { AppBar } from '../AppBar'
import { ScreenFrame } from '../ScreenFrame'
import { AllScreen } from './AllScreen'

const meta = {
  title: '画面/すべて',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

export const Default: Story = {
  name: 'すべて',
  render: () => {
    const lib = sampleLibrary()
    return (
      <ScreenFrame bar={<AppBar lib={lib} here="all" crumbs={['すべて']} />}>
        <AllScreen lib={lib} />
      </ScreenFrame>
    )
  },
}
