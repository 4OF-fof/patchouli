import { existsSync } from 'node:fs'
import type { StorybookConfig } from 'storybook-solidjs-vite'

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
  // docgen は node_modules の .jsx（lucide-solid のアイコン 2000 個余り）まで型解析し、初回の表示が数分かかる
  framework: { name: 'storybook-solidjs-vite', options: { docgen: false } },
  staticDirs: existsSync(devLibrary) ? [{ from: '../../example/dev-library', to: '/dev-library' }] : [],
  viteFinal: (vite) => {
    // builder-vite は vite.config.ts の server を丸ごと置き換えるので、Rust のビルド出力の除外をここで足す
    const watch = ((vite.server ??= {}).watch ??= {})
    watch.ignored = [...[watch.ignored ?? []].flat(), '**/src-tauri/**', '**/plugins/target/**']
    return vite
  },
}
export default config
