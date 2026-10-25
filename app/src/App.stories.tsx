import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { App } from './App'
import { sampleLibrary } from './samples/library'

const meta = {
  title: '画面/通し',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj

/** 動くモックと同じように、画面を押して行き来できる。Esc で戻る、Ctrl U で整理、Ctrl P で検索。 */
export const WalkThrough: Story = { name: '画面をつないだもの', render: () => <App lib={sampleLibrary()} /> }
