import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { App } from './App'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from './samples/library'
import { SAMPLE_SCREENS } from './samples/plugins'

const meta = {
  title: '画面/通し',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

export const WalkThrough: Story = {
  name: '画面をつないだもの',
  render: () => (
    <App lib={sampleLibrary()} screens={SAMPLE_SCREENS} pinnedProjects={PINNED_PROJECTS} pinnedTags={PINNED_TAGS} />
  ),
}
