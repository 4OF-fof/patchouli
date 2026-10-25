import type { Preview } from 'storybook-solidjs-vite'
import '../src/index.css'

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'テーマ',
      toolbar: {
        title: 'テーマ',
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'ダーク' },
          { value: 'light', title: 'ライト' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark' },
  decorators: [
    (Story, context) => {
      document.documentElement.dataset.theme = context.globals.theme
      return <Story />
    },
  ],
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
  },
}

export default preview
