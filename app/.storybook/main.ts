import { existsSync } from 'node:fs'
import type { StorybookConfig } from 'storybook-solidjs-vite'

// 動作確認用のライブラリ（scripts/dev-library.ts が作る）があれば、動画や画像のストーリーで /dev-library として使う
const devLibrary = new URL('../../example/dev-library', import.meta.url)

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-mcp',
  ],
  framework: 'storybook-solidjs-vite',
  staticDirs: existsSync(devLibrary) ? [{ from: '../../example/dev-library', to: '/dev-library' }] : [],
}
export default config
