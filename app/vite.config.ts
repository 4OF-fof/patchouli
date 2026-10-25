import path from 'node:path'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { defineConfig, lazyPlugins } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'
import solid from 'vite-plugin-solid'

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 120,
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'jsx-a11y', 'vitest'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      // Solid の `let el!: HTMLElement` + `ref={el}` はコンパイル時に代入されるので誤検知になる
      'no-unassigned-vars': 'off',
      // 部品は CSS を副作用の import で読み込む
      'import/no-unassigned-import': ['warn', { allow: ['**/*.css'] }],
      // 検索結果の listbox などは見た目のために ARIA で組んでいて、select などには置き換えられない
      'jsx-a11y/prefer-tag-over-role': 'off',
    },
    env: {
      builtin: true,
      browser: true,
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  plugins: lazyPlugins(() => [solid()]),
  test: {
    // vite-plugin-solid は既定で jsdom を使おうとするので、明示しておく
    environment: 'node',
    projects: [
      {
        // 画面に依存しない処理のテスト（src/**/*.test.ts）
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        // Storybook のストーリーを Chromium で描画できるか確かめる
        extends: true,
        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
